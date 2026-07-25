import { describe, expect, test } from "vitest";
import { deepEquals } from "./deepEquals";
import { cachedHash, type HashContext, hash, sortedHashArray } from "./hash";
import type { Json } from "./types";

describe("hash", () => {
    test.each([
        ["null", null],
        ["true", true],
        ["false", false],
        ["zero", 0],
        ["negative zero", -0],
        ["positive number", 42],
        ["negative number", -42],
        // biome-ignore lint/suspicious/noApproximativeNumericConstant: an arbitrary fractional test value, not meant to approximate Math.PI
        ["fractional number", 3.14159],
        ["NaN", NaN],
        ["Infinity", Infinity],
        ["-Infinity", -Infinity],
        ["empty string", ""],
        ["short string", "hello"],
        ["unicode string", "héllo 你好 😀"],
        ["empty array", []],
        ["empty object", {}],
        ["nested array", [1, [2, 3], { a: 4 }]],
        ["nested object", { a: 1, b: { c: 2 } }],
    ] as [name: string, val: Json][])("is deterministic for %s", (_name, val) => {
        expect(hash(val)).toBe(hash(val));
    });

    test("treats -0 and 0 as equal, matching deepEqual/===", () => {
        expect(hash(-0)).toBe(hash(0));
    });

    test("returns an unsigned 32-bit integer", () => {
        for (const val of [0, 1, "a very long string ".repeat(50), { a: [1, 2, 3] }]) {
            const h = hash(val);
            expect(h).toBeGreaterThanOrEqual(0);
            expect(h).toBeLessThanOrEqual(0xffffffff);
            expect(Number.isInteger(h)).toBe(true);
        }
    });

    describe("type-tag collision prevention", () => {
        test.each([
            ['number 5 vs string "5"', 5, "5"],
            ['true vs string "true"', true, "true"],
            ["null vs false", null, false],
            ["0 vs empty string", 0, ""],
            ["empty array vs empty object", [], {}],
        ] as [name: string, a: Json, b: Json][])("%s hash differently", (_name, a, b) => {
            expect(hash(a)).not.toBe(hash(b));
        });
    });

    describe("array order-sensitivity", () => {
        test("hashes differently when element order differs", () => {
            expect(hash([1, 2, 3])).not.toBe(hash([3, 2, 1]));
        });

        test("hashes the same for identical order", () => {
            expect(hash([1, "a", { b: 2 }])).toBe(hash([1, "a", { b: 2 }]));
        });
    });

    describe("object key order-insensitivity", () => {
        test("hashes the same regardless of key order", () => {
            expect(hash({ a: 1, b: 2, c: 3 })).toBe(hash({ c: 3, a: 1, b: 2 }));
        });

        test("hashes differently when values differ", () => {
            expect(hash({ a: 1, b: 2 })).not.toBe(hash({ a: 1, b: 3 }));
        });

        test("hashes differently when a key is missing", () => {
            expect(hash({ a: 1, b: 2 })).not.toBe(hash({ a: 1 }));
        });
    });

    describe("deepEqual implies equal hash", () => {
        test.each([
            [
                { a: 1, b: { c: [1, 2, 3] } },
                { b: { c: [1, 2, 3] }, a: 1 },
            ],
            [
                [1, { a: 2 }, [3, 4]],
                [1, { a: 2 }, [3, 4]],
            ],
            [null, null],
            [-0, 0],
        ] as [Json, Json][])("holds for %o vs %o", (a, b) => {
            expect(deepEquals(a, b)).toBe(true);
            expect(hash(a)).toBe(hash(b));
        });
    });

    test("does not stack overflow on a deeply nested object, and matches the shallow-recursive result", () => {
        const depth = 100_000;
        const makeDeep = () => {
            let obj: Json = { leaf: true };
            for (let i = depth; i >= 0; i--) obj = { [`key_${i}`]: obj };
            return obj;
        };

        const a = makeDeep();
        const b = makeDeep();

        // Both go through the same (iterative fallback) code path at this depth, and must still
        // agree with each other exactly as the recursive-only case does for shallow structures -
        // otherwise the recursive/iterative split would be observable, not just an internal detail.
        // (Unlike deepClone.ts/deepEquals.ts, hash.ts's recursion is heavy enough per frame that
        // this depth genuinely does overflow here - confirmed via coverage, not assumed.)
        expect(hash(a)).toBe(hash(b));

        let ref: object = b;
        for (let i = 0; i < depth - 1; i++) ref = ref[`key_${i}` as never];
        ref[`key_${depth - 1}` as never] = { leaf: false } as never;
        expect(hash(a)).not.toBe(hash(b));
    });

    test("does not stack overflow on a deeply nested array, exercising the iterative fallback's array-frame path", () => {
        const depth = 100_000;
        const makeDeep = (leaf: Json) => {
            let arr: Json = [leaf, "a", true, null, 42];
            for (let i = 0; i < depth; i++) arr = [arr, i];
            return arr;
        };

        expect(hash(makeDeep(1))).toBe(hash(makeDeep(1)));
        expect(hash(makeDeep(1))).not.toBe(hash(makeDeep(2)));
    });

    test("does not swallow a non-RangeError exception", () => {
        const src = {
            get poison(): never {
                throw new TypeError("not a stack overflow");
            },
        };
        expect(() => hash(src)).toThrow(TypeError);
    });
});

describe("cachedHash", () => {
    test("returns the same value as hash() for primitives", () => {
        const ctx: HashContext = { hash, cache: new WeakMap() };
        expect(cachedHash(5, ctx)).toBe(hash(5));
        expect(cachedHash("a", ctx)).toBe(hash("a"));
        expect(cachedHash(null, ctx)).toBe(hash(null));
        expect(cachedHash(true, ctx)).toBe(hash(true));
    });

    test("returns the same value as hash() for objects/arrays", () => {
        const ctx: HashContext = { hash, cache: new WeakMap() };
        const obj = { a: 1, b: [2, 3] };
        expect(cachedHash(obj, ctx)).toBe(hash(obj));
    });

    test("memoizes by reference - a second call with the same object reuses the cached value", () => {
        const ctx: HashContext = { hash, cache: new WeakMap() };
        const obj = { a: 1 };
        const first = cachedHash(obj, ctx);
        expect(ctx.cache.get(obj)).toBe(first);
        // Mutate after caching - a fresh hash() would now differ, but cachedHash must still
        // return the stale cached value since the ctx is only safe within a single diff() call
        // (the contract documented in hash.ts), not across mutations.
        (obj as { a: number }).a = 2;
        expect(cachedHash(obj, ctx)).toBe(first);
    });

    test("does not share a ctx entry between different object references with equal content", () => {
        const ctx: HashContext = { hash, cache: new WeakMap() };
        const a = { x: 1 };
        const b = { x: 1 };
        cachedHash(a, ctx);
        expect(ctx.cache.has(b)).toBe(false);
        expect(cachedHash(b, ctx)).toBe(hash(b));
    });
});

describe("sortedHashArray", () => {
    function expectSortedByHash<T>(result: ReturnType<typeof sortedHashArray<T>>): void {
        for (let i = 1; i < result.length; i++) {
            expect(result[i - 1]?.hash).toBeLessThanOrEqual(result[i]?.hash as number);
        }
    }

    test("returns an empty array for an empty input", () => {
        const ctx: HashContext = { hash, cache: new WeakMap() };
        expect(sortedHashArray([], ctx)).toEqual([]);
    });

    test("sorts a small array (insertion-sort path) by hash and preserves value/index", () => {
        const ctx: HashContext = { hash, cache: new WeakMap() };
        const input: Json[] = ["e", "d", "c", "b", "a", 1, 2, true, null, {}];
        const result = sortedHashArray(input, ctx);

        expect(result).toHaveLength(input.length);
        expectSortedByHash(result);
        for (const entry of result) {
            expect(entry.value).toBe(input[entry.index]);
            expect(entry.hash).toBe(hash(input[entry.index] as Json));
        }
    });

    test("sorts a large array (native-sort path, above the insertion-sort threshold) correctly", () => {
        const ctx: HashContext = { hash, cache: new WeakMap() };
        // Threshold is 128 - use an array comfortably above it, in reverse-ish order to avoid
        // accidentally starting already-sorted.
        const input: number[] = Array.from({ length: 300 }, (_, i) => 300 - i);
        const result = sortedHashArray(input, ctx);

        expect(result).toHaveLength(input.length);
        expectSortedByHash(result);
        for (const entry of result) {
            expect(entry.value).toBe(input[entry.index]);
        }
    });

    test("is stable: equal-hash (duplicate value) elements keep their original relative order", () => {
        const ctx: HashContext = { hash, cache: new WeakMap() };
        // Every element hashes identically (all "dup"), so a stable sort must return them in
        // original index order (0, 1, 2, ...) - any reordering would indicate an unstable sort.
        const input: string[] = Array.from({ length: 20 }, () => "dup");
        const result = sortedHashArray(input, ctx);

        expect(result.map((r) => r.index)).toEqual(input.map((_, i) => i));
    });

    test("is stable at large scale too (native-sort path with duplicates)", () => {
        const ctx: HashContext = { hash, cache: new WeakMap() };
        const input: string[] = Array.from({ length: 300 }, () => "dup");
        const result = sortedHashArray(input, ctx);

        expect(result.map((r) => r.index)).toEqual(input.map((_, i) => i));
    });

    test("reuses cached hashes across two separate sortedHashArray calls sharing the same ctx", () => {
        const ctx: HashContext = { hash, cache: new WeakMap() };
        const shared = { a: 1 };
        const oldArr = [shared, { b: 2 }];
        const newArr = [shared, { c: 3 }];

        sortedHashArray(oldArr, ctx);
        expect(ctx.cache.has(shared)).toBe(true);
        const cachedValue = ctx.cache.get(shared);

        const result = sortedHashArray(newArr, ctx);
        const entry = result.find((r) => r.value === shared);
        expect(entry?.hash).toBe(cachedValue);
    });
});

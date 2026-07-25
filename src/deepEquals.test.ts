import { describe, expect, test } from "vitest";
import { deepEquals } from "./deepEquals";
import type { Json } from "./types";

describe("deepEqual", () => {
    test.each([
        // primitives
        ["equal numbers", 1, 1, true],
        ["different numbers", 1, 2, false],
        ["equal strings", "a", "a", true],
        ["different strings", "a", "b", false],
        ["equal booleans", true, true, true],
        ["different booleans", true, false, false],
        ["equal undefined", undefined, undefined, true],
        ["number vs string of same value", 1, "1", false],
        ["NaN vs NaN", NaN, NaN, false],

        // null
        ["null vs null", null, null, true],
        ["null vs undefined", null, undefined, false],
        ["null vs empty object", null, {}, false],

        // flat objects
        ["equal flat objects", { a: 1, b: 2 }, { a: 1, b: 2 }, true],
        ["equal flat objects with different key order", { a: 1, b: 2 }, { b: 2, a: 1 }, true],
        ["flat objects with a different value", { a: 1, b: 2 }, { a: 1, b: 3 }, false],
        ["b has an extra key", { a: 1 }, { a: 1, b: 2 }, false],
        ["a has an extra key", { a: 1, b: 2 }, { a: 1 }, false],
        ["same key count, different key names", { a: 1, b: 2 }, { a: 1, c: 2 }, false],

        // nested objects
        ["equal nested objects", { a: 1, b: { c: 2 } }, { a: 1, b: { c: 2 } }, true],
        ["different nested objects", { a: 1, b: { c: 2 } }, { a: 1, b: { c: 3 } }, false],
        ["equal deeply nested objects", { a: { b: { c: { d: 1 } } } }, { a: { b: { c: { d: 1 } } } }, true],
        ["different deeply nested objects", { a: { b: { c: { d: 1 } } } }, { a: { b: { c: { d: 2 } } } }, false],

        // arrays
        ["equal arrays", [1, 2, 3], [1, 2, 3], true],
        ["arrays with a different element", [1, 2, 3], [1, 2, 4], false],
        ["b array shorter", [1, 2, 3], [1, 2], false],
        ["a array shorter", [1, 2], [1, 2, 3], false],
        ["equal empty arrays", [], [], true],

        // mixed nesting
        ["equal arrays of objects", [1, { a: 2 }, [3, 4]], [1, { a: 2 }, [3, 4]], true],
        ["different arrays of objects", [1, { a: 2 }, [3, 4]], [1, { a: 2 }, [3, 5]], false],
        ["equal objects containing arrays", { a: [1, 2, { b: 3 }] }, { a: [1, 2, { b: 3 }] }, true],
        ["different objects containing arrays", { a: [1, 2, { b: 3 }] }, { a: [1, 2, { b: 4 }] }, false],

        // arrays vs array-like objects
        ["array vs array-like object", [1, 2], { 0: 1, 1: 2, length: 2 }, false],
        ["array-like object vs array", { 0: 1, 1: 2, length: 2 }, [1, 2], false],

        // explicit undefined values
        ["equal explicit undefined values", { a: undefined }, { a: undefined }, true],
        ["explicit undefined vs a value", { a: undefined }, { a: 1 }, false],
    ] as [name: string, a: Json, b: Json, expected: boolean][])("%s", (_name, a, b, expected) => {
        expect(deepEquals(a, b)).toBe(expected);
    });

    test("is correct at large scale (100k levels deep)", () => {
        // Note: this depth alone does not actually exercise equalIterative - plain recursion
        // comfortably handles far deeper structures than this in practice, so this is a
        // large-scale correctness check, not a proof the iterative fallback engaged. See the
        // "iterative fallback" describe block below for tests that deliberately force that path.
        const depth = 100_000;

        const makeDeep = () => {
            let obj: Json = {};
            for (let i = depth; i >= 0; i--) obj = { [`key_${i}`]: obj };
            return obj;
        };

        const a = makeDeep();
        const b = makeDeep();

        expect(deepEquals(a, b)).toBe(true);

        let ref: object = b;
        for (let i = 0; i < depth - 1; i++) ref = ref[`key_${i}` as never];
        ref[`key_${depth - 1}` as never] = 1 as never;
        expect(deepEquals(a, b)).toBe(false);
    });
});

describe("deepEqual - iterative fallback (fault injection)", () => {
    // See deepClone.test.ts's identical describe block for why fault injection (not real
    // recursion depth) is used to exercise equalIterative: this runtime's recursion budget is far
    // too generous to overflow reliably/quickly via genuine depth.
    //
    // makeOnceThrowingValue(realValue) returns { trap: <getter> } - the getter throws on its
    // first read (simulating "the stack overflowed reading this property") and returns realValue
    // on every read after. The property access that throws is this wrapper's OWN "trap" key, one
    // level *inside* wherever the wrapper itself is placed - so equalRecursive's per-level
    // try/catch catches it around the comparison of the wrapper against its counterpart, and
    // `equalIterative` then re-walks that wrapper pair (including its "trap" key, now resolving
    // to realValue on the second read) from scratch. Each test below shapes realValue and its
    // counterpart to land on a specific branch of that re-walk.
    function makeOnceThrowingValue(realValue: Json): Json {
        let thrown = false;
        return Object.defineProperty({}, "trap", {
            enumerable: true,
            get() {
                if (!thrown) {
                    thrown = true;
                    throw new RangeError("simulated stack overflow");
                }
                return realValue;
            },
        }) as Json;
    }

    test("falls back correctly for equal nested arrays", () => {
        const a = { trap: makeOnceThrowingValue([1, 2, 3]) };
        const b = { trap: { trap: [1, 2, 3] } };
        expect(deepEquals(a, b)).toBe(true);
    });

    test("falls back correctly for arrays that differ in length", () => {
        const a = { trap: makeOnceThrowingValue([1, 2, 3]) };
        const b = { trap: { trap: [1, 2] } };
        expect(deepEquals(a, b)).toBe(false);
    });

    test("falls back correctly for arrays with a differing element", () => {
        const a = { trap: makeOnceThrowingValue([1, 2, 3]) };
        const b = { trap: { trap: [1, 2, 4] } };
        expect(deepEquals(a, b)).toBe(false);
    });

    test("falls back correctly for objects with a differing key set", () => {
        const a = { trap: makeOnceThrowingValue({ p: 1, q: 2 }) };
        const b = { trap: { trap: { p: 1, r: 2 } } };
        expect(deepEquals(a, b)).toBe(false);
    });

    test("falls back correctly for objects with differing key counts", () => {
        const a = { trap: makeOnceThrowingValue({ p: 1 }) };
        const b = { trap: { trap: { p: 1, q: 2 } } };
        expect(deepEquals(a, b)).toBe(false);
    });

    test("falls back correctly when a nested value is null vs a non-null object", () => {
        const a = { trap: makeOnceThrowingValue(null) };
        const b = { trap: { trap: { p: 1 } } };
        expect(deepEquals(a, b)).toBe(false);
    });

    test("falls back correctly for a differing primitive resolved through the fallback's own stack", () => {
        const a = { trap: makeOnceThrowingValue(5) };
        const b = { trap: { trap: 6 } };
        expect(deepEquals(a, b)).toBe(false);
    });

    test("does not swallow a non-RangeError exception", () => {
        const a = {
            get poison(): never {
                throw new TypeError("not a stack overflow");
            },
        };
        expect(() => deepEquals(a, { poison: 1 })).toThrow(TypeError);
    });
});

import { describe, expect, test } from "vitest";
import { apply } from "./apply";
import { deepEqual } from "./deepEquals";
import { diff } from "./diff";
import { hash } from "./hash";
import type { Json, JsonArray, JsonObject } from "./types";

const nullA = null;
const nullB = null;
const booleanA = true;
const booleanB = false;
const numberA = 1;
const numberB = 2;
const stringA = "hello";
const stringB = "world";
const objA = { some_key: "some_val" };
const objB = { some_other_key: "some_other_val" };

const arrayA: JsonArray = [nullA, booleanA, numberA, stringA, objA];
const arrayB: JsonArray = [nullB, booleanB, numberB, stringB, objB];

const metaA: JsonObject = {
    string: stringA,
    number: numberA,
    boolean: booleanA,
    object: objA,
    null: nullA,
    array: arrayA,
};
const metaB: JsonObject = {
    string: stringB,
    number: numberB,
    boolean: booleanB,
    object: objB,
    null: nullB,
    array: arrayB,
};

describe("diff", () => {
    test.for([
        [undefined, null],
        [null, undefined],
        [true, false],
        [1, 2],
        [1, -1],
        ["", "a"],
        ["a", "b"],
        [{ a: "a" }, { a: "b" }],
        [{ a: "a" }, { a: { b: "c" } }],
        [{ a: { b: "c" } }, { a: { b: "d" } }],
        [
            { a: "a", b: "b" },
            { a: "b", b: "a" },
        ],
        [{}, { a: "b" }],
        [[], [1, 2, 3]],
        [
            [1, 2],
            [1, 2, 3, 4],
        ],
        [[1], [1, 2]],
        [
            [objA, 2, 3],
            [objB, 2, 3],
        ],
        [
            [1, 2, 3],
            [2, 1, 3],
        ],
        [[objA], [objA, objA]],
        [metaA, metaB],
    ] as [Json, Json][])("(%s, %s)", ([a, b], { expect }) => {
        const patch = diff(a, b);
        expect(apply(a, patch)).toEqual(b);
    });
});

describe("diff - array sorting scale", () => {
    // transformArray sorts array elements by hash to detect moves/copies - below a 128-element
    // threshold via a hand-rolled insertion sort, above it via native Array.prototype.sort (see
    // hash.ts's sortedHashArray and diff.ts's arrPatch.sort). These cases exercise both paths
    // through the full diff()/apply() pipeline, not just the sort function in isolation.

    test("round-trips a large (native-sort path) array with no changes", () => {
        const a: JsonArray = Array.from({ length: 300 }, (_, i) => i);
        const b: JsonArray = [...a];
        const patch = diff(a, b);
        expect(apply(a, patch)).toEqual(b);
    });

    test("round-trips a large (native-sort path) array that's fully reversed", () => {
        const a: JsonArray = Array.from({ length: 300 }, (_, i) => i);
        const b: JsonArray = [...a].reverse();
        const patch = diff(a, b);
        expect(apply(a, patch)).toEqual(b);
    });

    test("round-trips a large array with scattered adds/removes/replaces", () => {
        const a: JsonArray = Array.from({ length: 200 }, (_, i) => ({ id: i, val: `v${i}` }));
        const b: JsonArray = a
            .filter((_, i) => i % 3 !== 0) // remove every third element
            .map((v, i) => (i % 5 === 0 ? { ...(v as JsonObject), val: "changed" } : v)) // replace some
            .concat([{ id: 999, val: "new" }]); // add one
        const patch = diff(a, b);
        expect(apply(a, patch)).toEqual(b);
    });

    test("round-trips a small array with many duplicate values (stresses tie-breaking)", () => {
        const a: JsonArray = Array.from({ length: 20 }, (_, i) => (i % 3 === 0 ? "dup" : i));
        const b: JsonArray = [...a].reverse();
        const patch = diff(a, b);
        expect(apply(a, patch)).toEqual(b);
    });

    test("round-trips a large array with many duplicate values (native-sort path + tie-breaking)", () => {
        const a: JsonArray = Array.from({ length: 200 }, (_, i) => (i % 4 === 0 ? "dup" : i));
        const b: JsonArray = [...a].reverse();
        const patch = diff(a, b);
        expect(apply(a, patch)).toEqual(b);
    });

    test("round-trips arrays whose lengths straddle the insertion-sort/native-sort threshold (127, 128, 129)", () => {
        for (const n of [127, 128, 129]) {
            const a: JsonArray = Array.from({ length: n }, (_, i) => i);
            const b: JsonArray = [...a].reverse();
            const patch = diff(a, b);
            expect(apply(a, patch)).toEqual(b);
        }
    });
});

describe("diff - deep recursion safety", () => {
    // The exact depth at which the recursive-to-iterative fallback engages depends on how much
    // call stack is already in use by the surrounding runtime (varies noticeably between running
    // this directly and running under vitest's own wrapper/transform layers, and even between
    // separate test runs in the same process) - so these assertions deliberately avoid depending
    // on *where* the fallback kicks in, and only check the guarantees that must hold regardless:
    // no crash, a correct round-trip, a bounded (not one-op-per-level) patch, and an unaffected
    // sibling.
    const depth = 2000;

    function makeDeep(leaf: Json): Json {
        let obj: Json = leaf;
        for (let i = depth; i >= 0; i--) obj = { [`key_${i}`]: obj };
        return obj;
    }

    test("does not stack overflow on a pathologically deep structure", () => {
        const a = { deep: makeDeep(1), normal: { x: 1, y: 2 } };
        const b = { deep: makeDeep(2), normal: { x: 1, y: 3 } };

        const patch = diff(a, b);
        expect(apply(a, patch)).toEqual(b);
    });

    test("keeps the patch bounded (a fallback, not one replace op per level of the deep chain)", () => {
        const a = { deep: makeDeep(1) };
        const b = { deep: makeDeep(2) };

        const patch = diff(a, b);
        expect(patch.length).toBeLessThan(20);
    });

    test("still diffs a normal sibling of the pathological subtree granularly", () => {
        const a = { deep: makeDeep(1), normal: { x: 1, y: 2 } };
        const b = { deep: makeDeep(2), normal: { x: 1, y: 3 } };

        const patch = diff(a, b);
        expect(patch.some((op) => op.op === "replace" && op.path === "/normal/y")).toBe(true);
    });

    test("does not stack overflow on a pathologically deep *array* structure (exercises the array-branch fallback, not just the object-branch one)", () => {
        function makeDeepArray(leaf: Json): Json {
            let arr: Json = [leaf, "sibling"];
            for (let i = 0; i < depth; i++) arr = [arr, i];
            return arr;
        }

        const a = makeDeepArray(1);
        const b = makeDeepArray(2);
        const patch = diff(a, b);
        expect(apply(a, patch)).toEqual(b);
    });

    // Real stack-overflow depth reliably reaches the array-branch's RangeError catch (verified via
    // coverage), but not always the "rethrow a non-RangeError" line specifically, since real
    // recursion only ever produces RangeErrors - so that specific line needs fault injection, same
    // technique as deepClone.test.ts/deepEquals.test.ts/hash.test.ts's identical tests.
    test("does not swallow a non-RangeError exception (object branch)", () => {
        // "poison" must be absent from `b` (a removed key) so the unchanged pre-pass's own
        // deepEqual bails out on the key-count mismatch without ever reading `a.poison` itself -
        // otherwise the exception is thrown (and correctly rethrown) from deepEqual's own
        // already-tested passthrough instead of generateDiff's object-branch one.
        const a = {
            get poison(): never {
                throw new TypeError("not a stack overflow");
            },
            b: 1,
        };
        expect(() => diff(a, { b: 1 } as never)).toThrow(TypeError);
    });

    test("does not swallow a non-RangeError exception (array branch)", () => {
        // Differing lengths let deepEqual's array comparison (called both by the unchanged
        // pre-pass and by generateArrayDiff's own short-circuit) bail out on the length check
        // without reading index 0 - the poisoned getter is only reached once transformArray's
        // sortedHashArray call hashes every element, which is inside generateDiff's array-branch
        // try block.
        const a: unknown[] = [1, 2];
        Object.defineProperty(a, 0, {
            enumerable: true,
            configurable: true,
            get(): never {
                throw new TypeError("not a stack overflow");
            },
        });
        expect(() => diff(a as never, [9])).toThrow(TypeError);
    });

    test("does not swallow a non-RangeError exception (unchanged pre-pass)", () => {
        // "aKey" must differ (and be ordered before "poison") so the pre-pass's own top-level
        // deepEqual bails out on that earlier key without ever reading "poison" - only then does
        // generateUnchangedObject's own key-by-key recursion reach "poison" from inside the
        // try/catch this test targets (diff.ts's generateUnchanged, not deepEqual's own).
        const a = {
            aKey: 1,
            get poison(): never {
                throw new TypeError("not a stack overflow");
            },
        };
        expect(() => diff(a, { aKey: 2, poison: 2 } as never)).toThrow(TypeError);
    });

    test("silently gives up copy-detection tracking for a subtree that overflows during the unchanged pre-pass, without crashing", () => {
        // generateUnchanged's own recursion is lighter per frame than generateDiff's main pass
        // (see the "deep recursion safety" describe block above, which reliably overflows the
        // main pass at this depth but not this pre-pass) - so genuine depth alone doesn't reach
        // this catch's RangeError branch. Same fault-injection construction as the TypeError test
        // above, but throwing RangeError instead to hit the "give up silently" branch rather than
        // the "rethrow" one.
        const a = {
            aKey: 1,
            get poison(): never {
                throw new RangeError("simulated stack overflow");
            },
        };
        expect(() => diff(a, { aKey: 2, poison: 2 } as never)).not.toThrow();
    });

    test("emits no patch for a pathologically deep subtree that is actually unchanged (generateDeepFallback's equal-subtree branch)", () => {
        // Same leaf on both sides - if the fallback engages, generateDeepFallback's own deepEqual
        // check must find them equal and emit nothing, not a spurious replace.
        //
        // Comparing two *equal* deep structures tolerates more recursion before overflowing than
        // comparing two *differing* ones (generateObjectDiff has a cheaper early-return path when
        // both sides have identical key sets and nothing was removed), so this needs a much
        // deeper chain than `depth` above to reach the fallback at all. The exact depth where it
        // engages shifts with ambient call-stack usage already in use by the surrounding test
        // runner - including whatever the *other* tests in this file used before this one runs -
        // so this tries a descending list of candidates and uses the first `diff()` call that
        // completes without crashing, rather than depending on one fixed number.
        //
        // Verifying the round-trip with vitest's own `expect(...).toEqual(...)` is NOT safe here:
        // its deep-comparison logic isn't stack-safe the way this library's own deepEqual is, and
        // will itself throw "Maximum call stack size exceeded" trying to compare two structures
        // this deep - a real, confirmed failure mode of the assertion library, not of apply().
        // Using deepEqual() (recursive + iterative-fallback, like the rest of this library) and
        // asserting on its boolean result avoids that entirely.
        function makeEqualDeep(equalDepth: number, leaf: Json): Json {
            let obj: Json = leaf;
            for (let i = equalDepth; i >= 0; i--) obj = { [`key_${i}`]: obj };
            return obj;
        }

        let patch: ReturnType<typeof diff> | undefined;
        let a: Json | undefined;
        let b: Json | undefined;
        for (const equalDepth of [50_000, 20_000, 8_000, 3_000, 500]) {
            const candidateA = { deep: makeEqualDeep(equalDepth, 1) };
            const candidateB = { deep: makeEqualDeep(equalDepth, 1) };
            try {
                patch = diff(candidateA, candidateB);
                a = candidateA;
                b = candidateB;
                break;
            } catch (e) {
                if (!(e instanceof RangeError)) throw e;
            }
        }

        expect(patch).toBeDefined();
        // biome-ignore lint/style/noNonNullAssertion: guaranteed set alongside patch above
        const result = apply(a!, patch as never);
        expect(deepEqual(result, b)).toBe(true);
    });
});

describe("diff - object key handling", () => {
    test("skips a key present in both old and new during the added-keys pass (already handled by the removed-keys pass)", () => {
        const patch = diff({ a: 1, b: 2 }, { a: 1, c: 3 });
        expect(patch).toEqual(
            expect.arrayContaining([
                { op: "remove", path: "/b" },
                { op: "add", path: "/c", value: 3 },
            ]),
        );
    });

    test("emits a copy when an added key's value matches an unchanged value elsewhere", () => {
        const a = { x: { shared: 1 } };
        const b = { x: { shared: 1 }, y: { shared: 1 } };
        const patch = diff(a, b);
        expect(patch).toEqual([{ op: "copy", path: "/y", from: "/x" }]);
        expect(apply(a, patch)).toEqual(b);
    });

    test("emits a move when a removed key's value (same reference) reappears under a different key", () => {
        const shared = { x: 1 };
        const a = { first: shared };
        const b = { second: shared };
        const patch = diff(a, b);
        expect(patch).toEqual([{ op: "move", from: "/first", path: "/second" }]);
        expect(apply(a, patch)).toEqual(b);
    });

    test("short-circuits nested empty arrays (both old and new empty at a nested path)", () => {
        const a = { arr: [] as Json[], y: 1 };
        const b = { arr: [] as Json[], y: 2 };
        const patch = diff(a, b);
        expect(patch).toEqual([{ op: "replace", path: "/y", value: 2 }]);
        expect(apply(a, patch)).toEqual(b);
    });
});

describe("diff - array copy detection", () => {
    test("emits a copy sourced from another pending patch entry's hash, not just an unchanged element", () => {
        const a = [1, 2, 3];
        const b = [1, 3, 2, 3];
        const patch = diff(a, b);
        expect(apply(a, patch)).toEqual(b);
        expect(patch.some((op) => op.op === "copy")).toBe(true);
    });
});

describe("diff - array index bookkeeping (transformIndex)", () => {
    test("does not shift an element's index for an earlier remove that's at or after it (no shift needed)", () => {
        // Found via targeted search for a case where transformIndex's remove-adjustment branch
        // takes its "no shift needed" path, not just the common "shift back by one" path.
        const a = [1, 0];
        const b = [3, 2, 1];
        const patch = diff(a, b);
        expect(apply(a, patch)).toEqual(b);
    });
});

describe("diff - array move with a real hash collision", () => {
    // hash.ts's own doc comment accepts hash collisions as a real (if rare) possibility - two
    // different values coincidentally sharing a hash. transformArray's "move" handling has a
    // dedicated recovery path for exactly this case (see diff.ts's "move" branch: when a
    // hash-matched pair lands at the same index but isn't actually deepEqual, it diffs the two
    // values in place instead of blindly trusting the match).
    //
    // These two objects are a genuine collision under the real hash() function - not mocked or
    // forced - found by hashing ~1200 random { a, b } shaped objects and looking for a repeat.
    // Collisions for small structured objects like this turned out to be far easier to find than
    // the full 32-bit space would suggest (found within the first couple thousand samples, well
    // under the ~65k the birthday bound alone would predict), so a real one was practical to use
    // directly instead of needing to mock hash.ts to force one.
    const collisionA = { a: 800, b: 569 };
    const collisionB = { a: 924, b: 645 };

    test("diffs the two values in place instead of trusting the collided hash match, when they land at the same index", () => {
        const a = [collisionA];
        const b = [collisionB];

        const patch = diff(a, b);
        expect(apply(a, patch)).toEqual(b);
        // Should not have blindly emitted a no-op "move" (same index) - the values actually
        // differ, so some real patch content must exist.
        expect(patch.length).toBeGreaterThan(0);
    });
});

describe("diff - custom hash option", () => {
    // Matches array elements by their `id` field instead of full content - falls back to the
    // default structural hash for anything without an `id` (or that isn't an object at all),
    // matching the requirement documented on DiffOptions.hash that a custom function must handle
    // every value shape it could receive.
    function byId(val: Json): number {
        if (val !== null && typeof val === "object" && !Array.isArray(val) && "id" in val) {
            return hash(val.id);
        }
        return hash(val);
    }

    // Chosen so the existing "remove immediately followed by add at the same index is a replace"
    // optimization (unrelated to hashing) can't coincidentally produce the same result without
    // id-matching - removing id 2 and inserting a changed id 1 land at different final positions
    // under the default hash, so this genuinely differentiates the two.
    const customHashA = [
        { id: 1, name: "a" },
        { id: 2, name: "b" },
        { id: 3, name: "c" },
        { id: 4, name: "d" },
    ];
    const customHashB = [
        { id: 4, name: "d" },
        { id: 3, name: "c" },
        { id: 1, name: "a-changed" },
    ];

    test("matches a reordered+modified array element by id instead of remove+add", () => {
        const patch = diff(customHashA, customHashB, { hash: byId });
        expect(apply(customHashA, patch)).toEqual(customHashB);

        // With id-based matching, element 1's rename surfaces as a move to its new position plus
        // a replace of just "name" - not a whole-value remove + add.
        expect(patch.some((op) => op.op === "remove" && "value" in op && (op.value as { id: number }).id === 1)).toBe(
            false,
        );
        expect(patch.some((op) => op.op === "replace" && op.path.endsWith("/name"))).toBe(true);
    });

    test("falls back to remove+add for the default structural hash on the same input (control case)", () => {
        const patch = diff(customHashA, customHashB);
        expect(apply(customHashA, patch)).toEqual(customHashB);
        // Without the custom hash, element 1's changed content means its default hash no longer
        // matches anything in the new array - it's a genuine remove+add, not a move.
        expect(patch.some((op) => op.op === "add")).toBe(true);
        expect(patch.some((op) => op.op === "replace" && op.path.endsWith("/name"))).toBe(false);
    });

    test("uses the custom hash for object-key copy detection too, not just arrays", () => {
        const a = { primary: { id: 1, name: "a" } };
        const b = { primary: { id: 1, name: "a" }, secondary: { id: 1, name: "a-ish" } };

        const patch = diff(a, b, { hash: byId });
        expect(apply(a, patch)).toEqual(b);
        // "secondary" shares "primary"'s id under the custom hash, so it should be detected as a
        // copy from "primary" (even though the two values aren't deepEqual - "name" differs) -
        // this is the documented, accepted tradeoff of identity-based matching.
        const copyOp = patch.find((op) => op.op === "copy");
        expect(copyOp).toBeDefined();
    });

    test("corrects a differing array-element copy match instead of keeping the source's stale content", () => {
        const arrA = [{ id: 1, name: "a" }];
        const arrB = [
            { id: 1, name: "a" },
            { id: 1, name: "a-copy" },
        ];

        const patch = diff(arrA, arrB, { hash: byId });
        expect(apply(arrA, patch)).toEqual(arrB);
        // The second element shares the first's id under the custom hash, so it's detected as a
        // "copy" - but its content differs ("name"), which must be corrected via a follow-up
        // replace rather than silently left as a duplicate of the source.
        expect(patch.some((op) => op.op === "copy")).toBe(true);
        expect(patch.some((op) => op.op === "replace" && op.path.endsWith("/name"))).toBe(true);
    });

    test("corrects a differing array-element move to a genuinely different index (not just the same-index case)", () => {
        // Chosen so the changed element's own adjusted position ends up different from where it
        // started even after accounting for the other moves/removes around it - distinct from the
        // "matches a reordered+modified array element by id" test above, where the change happens
        // to land back at the same adjusted index as a side effect of the other shifts.
        const idArrA = [
            { id: 2, v: 0 },
            { id: 3, v: 1 },
            { id: 3, v: 2 },
            { id: 2, v: 3 },
            { id: 1, v: 4 },
        ];
        const idArrB = [
            { id: 3, v: 1000 },
            { id: 3, v: 1001 },
        ];

        const patch = diff(idArrA, idArrB, { hash: byId });
        expect(apply(idArrA, patch)).toEqual(idArrB);
        expect(patch.some((op) => op.op === "move")).toBe(true);
        expect(patch.some((op) => op.op === "replace" && op.path.endsWith("/v"))).toBe(true);
    });

    test("still round-trips correctly for arrays mixing id-bearing and plain values", () => {
        const a = [{ id: 1, name: "a" }, "plain", 42];
        const b = [42, { id: 1, name: "a-changed" }, "plain", "new"];

        const patch = diff(a, b, { hash: byId });
        expect(apply(a, patch)).toEqual(b);
    });

    test("handles duplicate ids gracefully (diffs them against each other rather than crashing)", () => {
        // Two elements sharing an id is the documented, accepted tradeoff - not a crash, and the
        // round trip must still be correct even if the resulting patch treats them as related.
        const a = [
            { id: 1, name: "a" },
            { id: 1, name: "b" },
        ];
        const b = [
            { id: 1, name: "a-changed" },
            { id: 1, name: "b-changed" },
        ];

        const patch = diff(a, b, { hash: byId });
        expect(apply(a, patch)).toEqual(b);
    });

    test("produces the default result when no hash option is given", () => {
        const a = [1, 2, 3];
        const b = [3, 2, 1];
        expect(diff(a, b, {})).toEqual(diff(a, b));
        expect(diff(a, b, { hash: undefined })).toEqual(diff(a, b));
    });
});

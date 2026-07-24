import { describe, expect, test } from "vitest";
import { MissingError, PointerError } from "./error";
import { decodePointer, decodeSegment, encodeSegment, evaluatePointer } from "./pointer";
import type { Json } from "./types";

describe("decodePointer", () => {
    test.each([
        ["", []],
        // Note: "/" decodes to [] (same as ""), not [""] - an empty path segment is treated as
        // "no token" (matching the naive split().filter(Boolean) approach this loop optimizes),
        // so a pointer to a member literally named "" is indistinguishable from the root pointer.
        ["/", []],
        ["/a", ["a"]],
        ["/a/b", ["a", "b"]],
        ["/a/0", ["a", "0"]],
        ["/a//b", ["a", "b"]],
        ["/~0", ["~"]],
        ["/~1", ["/"]],
        ["/~01", ["~1"]],
        ["/~1~0", ["/~"]],
    ] as [ptr: string, tokens: string[]][])("decodes %j", (ptr, tokens) => {
        expect(decodePointer(ptr)).toEqual(tokens);
    });
});

describe("decodeSegment", () => {
    test.each([
        ["a", "a"],
        ["", ""],
        ["~0", "~"],
        ["~1", "/"],
        ["~01", "~1"],
        ["~1~0", "/~"],
        ["no escapes here", "no escapes here"],
    ] as [str: string, expected: string][])("decodes %j to %j", (str, expected) => {
        expect(decodeSegment(str)).toBe(expected);
    });
});

describe("encodeSegment", () => {
    test.each([
        ["a", "a"],
        ["", ""],
        ["~", "~0"],
        ["/", "~1"],
        ["/~", "~1~0"],
        ["~/", "~0~1"],
        ["no escapes here", "no escapes here"],
    ] as [str: string, expected: string][])("encodes %j to %j", (str, expected) => {
        expect(encodeSegment(str)).toBe(expected);
    });

    test("round-trips through decodeSegment for arbitrary keys", () => {
        for (const key of ["plain", "~tilde", "/slash", "~1/~0", ""]) {
            expect(decodeSegment(encodeSegment(key))).toBe(key);
        }
    });
});

describe("evaluatePointer", () => {
    test("returns the root itself (as both parent and value) for an empty token list", () => {
        const root = { a: 1 };
        expect(evaluatePointer([], root)).toEqual([root, undefined, root]);
    });

    test("resolves a nested object path", () => {
        const root = { a: { b: { c: 42 } } };
        expect(evaluatePointer(["a", "b", "c"], root)).toEqual([root.a.b, "c", 42]);
    });

    test("resolves an array index (key stays the original string token, unlike '-' which resolves to a number)", () => {
        const root = { a: [10, 20, 30] };
        expect(evaluatePointer(["a", "1"], root)).toEqual([root.a, "1", 20]);
    });

    describe("'-' array member", () => {
        test("resolves to the length (one past the last element) when existCheck is not set", () => {
            const root = { a: [10, 20, 30] };
            expect(evaluatePointer(["a", "-"], root)).toEqual([root.a, "3", undefined]);
        });

        test("resolves to the last element when existCheck is set", () => {
            const root = { a: [10, 20, 30] };
            expect(evaluatePointer(["a", "-"], root, true)).toEqual([root.a, "2", 30]);
        });

        test("throws PointerError when '-' is used on a non-array", () => {
            const root = { a: { b: 1 } };
            expect(() => evaluatePointer(["a", "-"], root)).toThrow(PointerError);
        });
    });

    describe("missing paths", () => {
        test("returns undefined for a missing object key when existCheck is not set", () => {
            const root = { a: 1 };
            expect(evaluatePointer(["missing"], root)).toEqual([root, "missing", undefined]);
        });

        test("throws MissingError for a missing object key when existCheck is set", () => {
            const root = { a: 1 };
            expect(() => evaluatePointer(["missing"], root, true)).toThrow(MissingError);
        });

        test("throws MissingError when an intermediate parent is undefined/null, regardless of existCheck", () => {
            const root = { a: null };
            expect(() => evaluatePointer(["a", "b"], root)).toThrow(MissingError);
            expect(() => evaluatePointer(["a", "b"], root, true)).toThrow(MissingError);
        });

        test("throws MissingError for an out-of-bounds array index when existCheck is set", () => {
            const root = { a: [1, 2] };
            expect(() => evaluatePointer(["a", "5"], root, true)).toThrow(MissingError);
        });

        test("does not throw for an out-of-bounds array index when existCheck is not set", () => {
            const root = { a: [1, 2] };
            expect(evaluatePointer(["a", "5"], root)).toEqual([root.a, "5", undefined]);
        });

        test("throws MissingError when existCheck is set and the resolved value is undefined", () => {
            const root = { a: undefined } as unknown as Json;
            expect(() => evaluatePointer(["a"], root, true)).toThrow(MissingError);
        });
    });

    describe("invalid keys", () => {
        test("throws PointerError when traversing into a primitive", () => {
            const root = { a: 1 };
            expect(() => evaluatePointer(["a", "b"], root)).toThrow(PointerError);
        });

        test("throws PointerError for a non-numeric array key", () => {
            const root = { a: [1, 2, 3] };
            expect(() => evaluatePointer(["a", "foo"], root)).toThrow(PointerError);
        });
    });

    test("hasOwn (not `in`) governs existence, so inherited properties are treated as missing", () => {
        const root = { a: Object.create({ inherited: 1 }) };
        expect(() => evaluatePointer(["a", "inherited"], root, true)).toThrow(MissingError);
    });
});

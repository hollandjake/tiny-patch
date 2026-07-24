import { describe, expect, test } from "vitest";
import { hasOwn } from "./utils";

describe("hasOwn", () => {
    test("returns true for an own string key", () => {
        expect(hasOwn({ a: 1 }, "a")).toBe(true);
    });

    test("returns false for a missing key", () => {
        expect(hasOwn({ a: 1 }, "b")).toBe(false);
    });

    test("returns false for an inherited (prototype-chain) key", () => {
        const obj = Object.create({ inherited: 1 });
        expect(hasOwn(obj, "inherited")).toBe(false);
    });

    test("returns true for an own key even if it shadows a prototype-chain key", () => {
        const obj = Object.create({ shared: 1 });
        obj.shared = 2;
        expect(hasOwn(obj, "shared")).toBe(true);
    });

    test("returns true for an own key with an undefined value", () => {
        expect(hasOwn({ a: undefined }, "a")).toBe(true);
    });

    test("works with numeric keys on arrays", () => {
        expect(hasOwn([1, 2, 3], 1)).toBe(true);
        expect(hasOwn([1, 2, 3], 5)).toBe(false);
    });

    test("returns false for an own object's built-in prototype methods", () => {
        expect(hasOwn({}, "toString")).toBe(false);
        expect(hasOwn({}, "hasOwnProperty")).toBe(false);
    });
});

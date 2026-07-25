import { describe, test } from "vitest";
import { apply } from "./apply";
import { deepFreeze } from "./deepFreeze";
import { MissingError } from "./error";
import type { Json } from "./types";

/**
 * https://datatracker.ietf.org/doc/html/rfc6902#appendix-A
 */
describe("Spec Compliance", () => {
    test("A.1 - Adding an Object Member", ({ expect }) => {
        const a = { foo: "bar" };
        expect(apply(a, [{ op: "add", path: "/baz", value: "qux" }])).toEqual({ foo: "bar", baz: "qux" });
        expect(a).toEqual({ foo: "bar" });
    });
    test("A.2 - Adding an Array Element", ({ expect }) => {
        const a = { foo: ["bar", "baz"] };
        expect(apply(a, [{ op: "add", path: "/foo/1", value: "qux" }])).toEqual({ foo: ["bar", "qux", "baz"] });
        expect(a).toEqual({ foo: ["bar", "baz"] });
    });
    test("A.3 - Removing an Object Member", ({ expect }) => {
        const a = { baz: "qux", foo: "bar" };
        expect(apply(a, [{ op: "remove", path: "/baz" }])).toEqual({ foo: "bar" });
        expect(a).toEqual({ baz: "qux", foo: "bar" });
    });
    test("A.4 - Removing an Array Element", ({ expect }) => {
        const a = { foo: ["bar", "qux", "baz"] };
        expect(apply(a, [{ op: "remove", path: "/foo/1" }])).toEqual({ foo: ["bar", "baz"] });
        expect(a).toEqual({ foo: ["bar", "qux", "baz"] });
    });
    test("A.5 - Replacing a Value", ({ expect }) => {
        const a = { baz: "qux", foo: "bar" };
        expect(apply(a, [{ op: "replace", path: "/baz", value: "boo" }])).toEqual({ baz: "boo", foo: "bar" });
        expect(a).toEqual({ baz: "qux", foo: "bar" });
    });
    test("A.6 - Moving a Value", ({ expect }) => {
        const a = {
            foo: { bar: "baz", waldo: "fred" },
            qux: { corge: "grault" },
        };
        expect(apply(a, [{ op: "move", from: "/foo/waldo", path: "/qux/thud" }])).toEqual({
            foo: { bar: "baz" },
            qux: { corge: "grault", thud: "fred" },
        });
        expect(a).toEqual({
            foo: { bar: "baz", waldo: "fred" },
            qux: { corge: "grault" },
        });
    });
    test("A.7 - Moving an Array Element", ({ expect }) => {
        const a = { foo: ["all", "grass", "cows", "eat"] };
        expect(apply(a, [{ op: "move", from: "/foo/1", path: "/foo/3" }])).toEqual({
            foo: ["all", "cows", "eat", "grass"],
        });
        expect(a).toEqual({ foo: ["all", "grass", "cows", "eat"] });
    });
    test("A.8 - Testing a Value: Success", ({ expect }) => {
        const a = { baz: "qux", foo: ["a", 2, "c"] };
        expect(() =>
            apply(a, [
                { op: "test", path: "/baz", value: "qux" },
                { op: "test", path: "/foo/1", value: 2 },
            ]),
        ).not.toThrow();
        expect(a).toEqual({ baz: "qux", foo: ["a", 2, "c"] });
    });
    test("A.9 - Testing a Value: Error", ({ expect }) => {
        const a = { baz: "qux" };
        expect(() => apply(a, [{ op: "test", path: "/baz", value: "bar" }])).toThrow();
        expect(a).toEqual({ baz: "qux" });
    });
    test("A.10 - Adding a Nested Member Object", ({ expect }) => {
        const a = { foo: "bar" };
        expect(apply(a, [{ op: "add", path: "/child", value: { grandchild: {} } }])).toEqual({
            foo: "bar",
            child: { grandchild: {} },
        });
        expect(a).toEqual({ foo: "bar" });
    });
    test("A.11 - Ignoring Unrecognized Elements", ({ expect }) => {
        const a = { foo: "bar" };
        expect(apply(a, [{ op: "add", path: "/baz", value: "qux", xyz: 123 } as never])).toEqual({
            foo: "bar",
            baz: "qux",
        });
        expect(a).toEqual({ foo: "bar" });
    });
    test("A.12 - Adding to a Nonexistent Target", ({ expect }) => {
        const a = { foo: "bar" };

        expect(() => apply(a, [{ op: "add", path: "/baz/bat", value: "qux" }])).toThrow();
        expect(a).toEqual({ foo: "bar" });
    });
    test("A.13 - Invalid JSON Patch Document", ({ expect }) => {
        const a = { foo: "bar" };
        expect(() => apply(a, [{ op: "INVALID", path: "/baz", value: "qux" } as never])).toThrow();
        expect(a).toEqual({ foo: "bar" });
    });
    test("A.14 - ~ Escape Ordering", ({ expect }) => {
        const a = { "/": 9, "~1": 10 };
        expect(() => apply(a, [{ op: "test", path: "/~01", value: 10 }])).not.toThrow();
        expect(a).toEqual({ "/": 9, "~1": 10 });
    });
    test("A.15 - Comparing Strings and Numbers", ({ expect }) => {
        const a = { "/": 9, "~1": 10 };
        expect(() => apply(a, [{ op: "test", path: "/~01", value: "10" }])).toThrow();
        expect(a).toEqual({ "/": 9, "~1": 10 });
    });
    test("A.16 - Adding an Array Value", ({ expect }) => {
        const a = { foo: ["bar"] };
        expect(apply(a, [{ op: "add", path: "/foo/-", value: ["abc", "def"] }])).toEqual({
            foo: ["bar", ["abc", "def"]],
        });
        expect(a).toEqual({ foo: ["bar"] });
    });
    test("4.4 - move when from not exist", ({ expect }) => {
        const a = { foo: ["bar"] };
        expect(() => apply(a, [{ op: "move", from: "/bar", path: "/foo" }])).toThrow();
    });
});

describe("Extended Spec", () => {
    test("E.1 - Patch values are cloned", ({ expect }) => {
        const a = {};
        const obj = { bar: "baz" };

        expect(
            apply(a, [
                { op: "add", path: "/foo", value: obj },
                { op: "replace", path: "/foo/bar", value: "qux" },
            ]),
        ).toEqual({ foo: { bar: "qux" } });

        expect(obj).toEqual({ bar: "baz" });
    });
    describe("E.2 - Replace root", () => {
        test.for([[null], [undefined], [true], [() => {}], ["a"], [0], [[]], [{ a: "a" }]] as [Json][])(
            "%o -> {}",
            ([a], { expect }) => {
                expect(apply(a, [{ op: "replace", path: "", value: {} }])).toEqual({});
            },
        );
    });
    describe("E.4 - Remove root", () => {
        test.for([[null], [true], ["a"], [0], [[1, 2]], [{ a: "a" }]] as [Json][])(
            "%o -> undefined",
            ([a], { expect }) => {
                expect(apply(a, [{ op: "remove", path: "" }])).toBeUndefined();
            },
        );

        test("move from the root removes the root first, then fails to resolve the destination against it", ({
            expect,
        }) => {
            // The root itself becomes undefined the instant it's removed (matching remove-root's own
            // behavior above) - so "to" can never resolve into it if "to" is anything but the root.
            const a = { foo: {} };
            expect(() => apply(a, [{ op: "move", from: "", path: "/foo" }])).toThrow(MissingError);
        });

        test("moving the root onto itself is a no-op", ({ expect }) => {
            const a = { foo: {} };
            expect(apply(a, [{ op: "move", from: "", path: "" }])).toEqual({ foo: {} });
        });
    });
    describe("E.3 - Key order preservation on move", () => {
        test("disabled by default: renaming a key in place moves it to the end", ({ expect }) => {
            const a = { a: 1, b: 2, c: 3 };
            const result = apply(a, [{ op: "move", from: "/b", path: "/x" }]);
            expect(Object.keys(result as any)).toEqual(["a", "c", "x"]);
            expect(result).toEqual({ a: 1, c: 3, x: 2 });
        });
        test("renaming a key in place keeps its original position", ({ expect }) => {
            const a = { a: 1, b: 2, c: 3 };
            const result = apply(a, [{ op: "move", from: "/b", path: "/x" }], { preserveKeyOrder: true });
            expect(Object.keys(result as any)).toEqual(["a", "x", "c"]);
            expect(result).toEqual({ a: 1, x: 2, c: 3 });
        });
        test("preserves order for a nested rename too", ({ expect }) => {
            const a = { foo: { bar: { a: 1, baz: "hi", c: 3 } } };
            const result = apply(a, [{ op: "move", from: "/foo/bar/baz", path: "/foo/bar/biz" }], {
                preserveKeyOrder: true,
            });
            expect(Object.keys((result as any).foo.bar)).toEqual(["a", "biz", "c"]);
            expect(result).toEqual({ foo: { bar: { a: 1, biz: "hi", c: 3 } } });
        });
        test("moving a key onto itself is a no-op, position included", ({ expect }) => {
            const a = { a: 1, b: 2, c: 3 };
            const result = apply(a, [{ op: "move", from: "/b", path: "/b" }], { preserveKeyOrder: true });
            expect(Object.keys(result as any)).toEqual(["a", "b", "c"]);
            expect(result).toEqual({ a: 1, b: 2, c: 3 });
        });
        test("moving a key onto a different existing key overwrites in place", ({ expect }) => {
            const a = { a: 1, b: 2, c: 3 };
            const result = apply(a, [{ op: "move", from: "/a", path: "/c" }], { preserveKeyOrder: true });
            expect(Object.keys(result as any)).toEqual(["b", "c"]);
            expect(result).toEqual({ b: 2, c: 1 });
        });
        test("moving between different objects still appends at the destination", ({ expect }) => {
            const a = { foo: { bar: "baz", waldo: "fred" }, qux: { corge: "grault" } };
            const result = apply(a, [{ op: "move", from: "/foo/waldo", path: "/qux/thud" }], {
                preserveKeyOrder: true,
            });
            expect(Object.keys((result as any).qux)).toEqual(["corge", "thud"]);
        });
    });
});

describe("readonly support", () => {
    test("applies a patch to a deeply-frozen target without throwing", ({ expect }) => {
        const a = deepFreeze<Json>({ foo: "bar", nested: { list: [1, 2, 3] } });
        const result = apply(a, [{ op: "add", path: "/baz", value: "qux" }]);
        expect(result).toEqual({ foo: "bar", nested: { list: [1, 2, 3] }, baz: "qux" });
        // the frozen source is left untouched
        expect(a).toEqual({ foo: "bar", nested: { list: [1, 2, 3] } });
    });

    test("the result of applying to a frozen target is itself mutable", ({ expect }) => {
        const a = deepFreeze({ foo: "bar" });
        const result = apply(a, [{ op: "replace", path: "/foo", value: "baz" }]) as any;
        expect(() => {
            result.foo = "mutated";
        }).not.toThrow();
        expect(result.foo).toBe("mutated");
    });

    test("still accepts an ordinary mutable target", ({ expect }) => {
        const a = { foo: "bar" };
        expect(apply(a, [{ op: "add", path: "/baz", value: "qux" }])).toEqual({ foo: "bar", baz: "qux" });
    });
});

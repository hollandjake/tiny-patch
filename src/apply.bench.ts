import { bench, describe } from "vitest";
import { apply } from "./apply";
import type { Maxi } from "./patch";
import type { Json } from "./types";

const baseNoBar = {
    foo: 1,
    baz: [
        {
            qux: "hello",
        },
    ],
};

const base = {
    ...baseNoBar,
    bar: [1, 2, 3, 4],
};

const actions = {
    add: {
        base: baseNoBar,
        op: { op: "add", path: "/bar", value: [1, 2, 3, 4] },
        expected: base,
    },
    remove: {
        base,
        op: { op: "remove", path: "/bar" },
        expected: baseNoBar,
    },
    replace: {
        base,
        op: { op: "replace", path: "/foo", value: [5, 6, 7, 8] },
        expected: { ...base, foo: [5, 6, 7, 8] },
    },
    move: {
        base,
        op: { op: "move", from: "/baz/0", path: "/bar/0" },
        expected: { ...base, baz: [], bar: [{ qux: "hello" }, 1, 2, 3, 4] },
    },
    copy: {
        base,
        op: { op: "copy", from: "/baz/0", path: "/bar/0" },
        expected: { ...base, bar: [{ qux: "hello" }, 1, 2, 3, 4] },
    },
    test: {
        base,
        op: {
            op: "test",
            path: "/baz",
            value: [{ qux: "hello" }],
        },
        expected: base,
    },
} satisfies Record<string, { base: Json; op: Maxi.Op; expected: Json }>;

describe("apply", () => {
    Object.entries(actions).forEach(([action, { base, op }]) => {
        bench(action, () => {
            apply(base, [op]);
        });
    });
});

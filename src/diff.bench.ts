import { bench, describe } from "vitest";
import { diff } from "./diff";
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

const scenarios = {
    add: {
        oldVal: baseNoBar,
        newVal: base,
    },
    remove: {
        oldVal: base,
        newVal: baseNoBar,
    },
    replace: {
        oldVal: base,
        newVal: { ...base, foo: [5, 6, 7, 8] },
    },
    move: {
        oldVal: base,
        newVal: { ...base, baz: [], bar: [{ qux: "hello" }, 1, 2, 3, 4] },
    },
    copy: {
        oldVal: base,
        newVal: { ...base, bar: [{ qux: "hello" }, 1, 2, 3, 4] },
    },
} satisfies Record<string, { oldVal: Json; newVal: Json }>;

describe("diff", () => {
    Object.entries(scenarios).forEach(([action, { oldVal, newVal }]) => {
        bench(action, () => {
            diff(oldVal, newVal);
        });
    });
});

import type { Json } from "./types";
import { hasOwn } from "./utils";

export function deepEquals(a: Json | undefined, b: Json | undefined): boolean {
    if (a === undefined || b === undefined) return a === b;
    return equalRecursive(a, b);
}

/**
 * Fast path: plain recursion lets the JIT inline and monomorphize the call, which beats
 * allocating a `[a, b]` tuple per comparison for every realistic (non-pathological) input.
 * Each recursive call wraps its own descent in a try/catch, so if a pathologically deep
 * structure overflows the call stack, only the failing subtree falls back to the iterative
 * version - not the whole comparison - see the stack-overflow test in deepEquals.test.ts.
 */
function equalRecursive(a: Json, b: Json): boolean {
    // Reference equality trivially implies deep equality - and lets a shared subtree (the very
    // common Redux/Immer-style "shallow copy, change a few things" update pattern: unchanged
    // parts of the new document are literally the same object as in the old one) skip walking
    // its entire contents to "prove" what reference identity already guarantees. Measured going
    // from ~66us to ~0.01us for a same-reference comparison on a real ~4KB nested object, with
    // negligible (~1%) cost added for the case where it doesn't hit (genuinely different objects).
    if (a === b) return true;

    const aType = typeof a;
    if (aType !== typeof b) return false;

    switch (aType) {
        case "object": {
            if (a === null || b === null) return false; // a === b already handled above

            try {
                if (Array.isArray(a)) {
                    if (!Array.isArray(b) || a.length !== b.length) return false;

                    for (let i = 0, l = a.length; i < l; i++) {
                        if (!equalRecursive(a[i], b[i])) return false;
                    }

                    return true;
                }

                const bKeys = Object.keys(b as object);
                const bLength = bKeys.length;
                if (Object.keys(a).length !== bLength) return false;

                for (let i = 0; i < bLength; i++) {
                    const k = bKeys[i] as string;
                    if (!hasOwn(a as object, k)) return false;
                    if (!equalRecursive((a as object)[k as never], (b as object)[k as keyof typeof b])) {
                        return false;
                    }
                }

                return true;
            } catch (e) {
                if (e instanceof RangeError) return equalIterative(a, b);
                throw e;
            }
        }
        default:
            return false; // a === b already handled above
    }
}

function equalIterative(a: Json, b: Json): boolean {
    const stack: [Json, Json][] = [[a, b]];

    while (stack.length > 0) {
        // biome-ignore lint/style/noNonNullAssertion: ignore
        const [x, y] = stack.pop()!;
        if (x === y) continue;

        const xType = typeof x;
        if (xType !== typeof y) return false;

        switch (xType) {
            case "object": {
                // x === y already handled above (continue) - reaching here with either null
                // means exactly one of them is null, so they can't be equal.
                if (x === null || y === null) return false;

                if (Array.isArray(x)) {
                    if (!Array.isArray(y) || x.length !== y.length) return false;

                    for (let i = 0, l = x.length; i < l; i++) {
                        stack.push([x[i], y[i]]);
                    }

                    break;
                }

                const yKeys = Object.keys(y as object);
                const yLength = yKeys.length;
                if (Object.keys(x as object).length !== yLength) {
                    return false;
                }

                for (let i = 0, k = yKeys[i]; i < yLength; i++, k = yKeys[i]) {
                    if (!hasOwn(x as object, k)) return false;
                    stack.push([x[k as never], (y as object)[k as keyof typeof y]]);
                }

                break;
            }
            default:
                return false; // x === y already handled above
        }
    }

    return true;
}

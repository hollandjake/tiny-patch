import type { DeepReadonly } from "./types";

// Freezes a value recursively at runtime without changing its static type - used across the
// readonly-support test suites to exercise real frozen data (mutation would throw in strict
// mode). Deliberately NOT typed as `<T>(val: T): DeepReadonly<T>`: TypeScript's inference for
// `MaybeReadonly<T>` parameters does not reliably narrow T back to the mutable shape when the
// argument's static type is already a `DeepReadonly<...>` produced by a generic helper, so such
// a helper's output fails to type-check against `MaybeReadonly<Json>`-based signatures even
// though the runtime shape is fine. Tests that need a genuinely `DeepReadonly`-typed value use a
// literal with an explicit type annotation (contextual typing) instead, then freeze it in place
// with this function.
export function deepFreeze<T>(o: T): DeepReadonly<T> {
    if (o === null || typeof o !== "object") return Object.freeze(o) as DeepReadonly<T>;

    const stack: object[] = [o];
    const seen = new Set<object>();

    while (stack.length > 0) {
        // biome-ignore lint/style/noNonNullAssertion: while loop assertion
        const current = stack.pop()!;
        if (seen.has(current)) continue;

        seen.add(current);
        Object.freeze(current);

        const values = Object.values(current);
        for (const value of values) {
            if (value !== null && typeof value === "object") stack.push(value);
        }
    }

    return o as DeepReadonly<T>;
}

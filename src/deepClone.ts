import type { DeepMutable, DeepReadonly, Json, JsonArray, JsonObject } from "./types";

/**
 * Creates a deep clone of the given JSON-compatible value.
 *
 * This has been heavily optimized for performance inside a JS runtime.
 *
 * @param val - The JSON-compatible value to be cloned. Can also be undefined.
 * @return A deep clone of the input value, or `undefined` if the input is `undefined`.
 */
export function deepClone<T extends Json | undefined>(val: DeepReadonly<T>): DeepMutable<T>;
export function deepClone<T extends Json | undefined>(val: T): DeepMutable<T>;
export function deepClone<T extends Json | undefined>(val: T): DeepMutable<T> {
    if (val === undefined) return val as DeepMutable<T>;
    return cloneRecursive(val) as DeepMutable<T>;
}

/**
 * Fast path: plain recursion lets the JIT inline and monomorphize the call,
 * which beats any manual stack bookkeeping for every realistic (non-pathological)
 * input - see src/deepClone.micro.bench.ts. Past MAX_RECURSION_DEPTH it
 * hands the remaining subtree to the iterative fallback, so pathologically
 * deep chains are handled without ever risking a stack overflow or redoing work.
 * Only the top-level deepClone() may receive undefined - Json never contains it
 * at any nested depth, so this helper's signature doesn't accept it either.
 */
function cloneRecursive<T extends Json>(val: T): T {
    if (typeof val !== "object" || val === null) return val;
    try {
        if (Array.isArray(val)) {
            // slice() is a native bulk copy that also pre-sets the destination's
            // element storage kind, then we only recurse into the object-valued
            // elements. For primitive-heavy arrays this is a near-pure native copy
            // (up to ~1.7x faster than element-by-element assignment);
            const out: JsonArray = val.slice();
            for (let i = 0, l = out.length; i < l; i++) {
                const value = out[i];
                if (value !== null && typeof value === "object") out[i] = cloneRecursive(value);
            }
            return out as T;
        }

        const out: JsonObject = {};
        for (const key in val) {
            const value = val[key];
            out[key] = value !== null && typeof value === "object" ? cloneRecursive(value) : value;
        }
        return out as T;
    } catch (e) {
        if (e instanceof RangeError) return cloneIterative(val);
        throw e;
    }
}

// Safe fallback for pathologically deep input: an explicit stack keeps memory
// usage on the heap instead of the call stack, so depth is bounded only by
// available memory. Like cloneRecursive, this only ever operates on Json (no
// undefined) since it's only reachable via nested (never top-level) values.
//
// Frames are tuples, not objects: on V8 (this package's actual runtime target -
// see engines in package.json) indexed tuple access consistently beats property
// access on an equivalent-shape object here (~10-35% faster on deep fixtures,
// see src/deepClone.micro.bench.ts) since it avoids hidden-class/property lookup
// entirely. The effect isn't universal across engines (noise-level on Bun/JSC),
// but never regresses, so the tuple form wins as the default.
type Frame =
    | [source: JsonArray, target: JsonArray, keys: undefined, index: number]
    | [source: JsonObject, target: JsonObject, keys: string[], index: number];

// Pushes a frame for `value` sized/typed to match, returning its target so the
// caller can wire it into the parent. Building both tuple slots (source/target,
// keys) from the same `Array.isArray` check is what lets the Frame union stay a
// real discriminated union instead of a manual pairing enforced by convention -
// every push site goes through here, so the pairing can't drift.
function pushFrame(stack: Frame[], value: JsonObject | JsonArray): JsonObject | JsonArray {
    if (Array.isArray(value)) {
        const target: JsonArray = [];
        stack.push([value, target, undefined, 0]);
        return target;
    }
    const target: JsonObject = {};
    stack.push([value, target, Object.keys(value), 0]);
    return target;
}

// Only ever called from cloneRecursive's catch block with the same `val` that already passed its
// `typeof val !== "object" || val === null` guard before entering the try - no need to repeat it.
function cloneIterative<T extends Json>(val: T): T {
    const stack: Frame[] = [];
    const root = pushFrame(stack, val as JsonObject | JsonArray);

    while (stack.length > 0) {
        // biome-ignore lint/style/noNonNullAssertion: stack is non-empty per the loop condition
        const current = stack[stack.length - 1]!;
        const keys = current[2];
        const index = current[3];

        if (keys === undefined) {
            const source = current[0];
            if (index >= source.length) {
                stack.pop();
                continue;
            }

            const value = source[index];
            current[3]++;

            if (value !== null && typeof value === "object") {
                current[1][index] = pushFrame(stack, value);
            } else {
                current[1][index] = value;
            }
        } else {
            if (index >= keys.length) {
                stack.pop();
                continue;
            }

            // biome-ignore lint/style/noNonNullAssertion: index is bounded by keys.length above
            const key = keys[index]!;
            current[3]++;

            const value = current[0][key];
            if (value !== null && typeof value === "object") {
                current[1][key] = pushFrame(stack, value);
            } else {
                current[1][key] = value;
            }
        }
    }

    return root as T;
}

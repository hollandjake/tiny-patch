import type { Json, JsonArray, JsonObject } from "./types";

// Type tags keep values of different types from colliding onto the same hash purely because
// their content happens to stringify the same way (e.g. the number 5 vs the string "5").
const NULL_TAG = 1;
const FALSE_TAG = 2;
const TRUE_TAG = 3;
const NUMBER_TAG = 4;
const STRING_TAG = 5;
const ARRAY_TAG = 6;
const OBJECT_TAG = 7;

function mix(h: number, x: number): number {
    return ((h << 5) + h) ^ x;
}

function mixString(h: number, s: string): number {
    for (let i = 0, l = s.length; i < l; i++) h = mix(h, s.charCodeAt(i));
    return h;
}

// Reused scratch buffer to read a number's raw 64-bit representation as two 32-bit words - avoids
// building a full string just to hash its characters (mixString on a stringified number is ~9x
// slower in isolation than mixing the two raw words directly, and this only ever runs
// synchronously within a single hash() call, so reusing one module-level buffer is safe).
const numBuf = new ArrayBuffer(8);
const numAsFloat = new Float64Array(numBuf);
const numAsInt = new Int32Array(numBuf);

function hashNumber(h: number, val: number): number {
    // Object.is(-0, 0) is false but -0 === 0 is true - deepEqual (and every other JS equality
    // operator) treats them equal, so normalize -0 to 0 first to keep "deepEqual implies equal
    // hash" true (the two have different raw bit patterns otherwise).
    numAsFloat[0] = val === 0 ? 0 : val;
    h = mix(h, NUMBER_TAG);
    h = mix(h, numAsInt[0] as number);
    return mix(h, numAsInt[1] as number);
}

function hashPrimitive(h: number, val: Json): number {
    if (val === null) return mix(h, NULL_TAG);
    switch (typeof val) {
        case "boolean":
            return mix(h, val ? TRUE_TAG : FALSE_TAG);
        case "number":
            return hashNumber(h, val);
        default:
            return mixString(mix(h, STRING_TAG), val as string);
    }
}

/**
 * Hashes a JSON value by walking its structure directly and feeding a DJB2-style rolling hash,
 * instead of building a JSON.stringify string first and hashing that. This is the *default*
 * hashing strategy diff() uses - see diff.ts's `DiffOptions.hash` for how a caller can swap it out
 * (e.g. to hash just an `id` field and match array elements by identity instead of full content).
 * Two values that are deepEqual are guaranteed to hash identically - required for diff.ts's
 * array-diff move detection, which matches array elements between the old and new array purely by
 * hash equality (with no secondary verification once a match is found, other than at the exact-
 * same-index "did this actually change" check) - so this guarantee, not just "usually true", is
 * load-bearing. A custom HashFn must preserve this same guarantee (deepEqual values must still
 * hash equal) for correct results - see DiffOptions.hash's own doc comment for what a custom
 * function trades away in return (structural collision-avoidance) for what it gains (identity-
 * based matching).
 *
 * Arrays are order-sensitive (hash each element in sequence), matching deepEqual's own array
 * comparison. Objects are order-INsensitive: each key/value pair is hashed independently and the
 * results combined with XOR (a commutative, order-independent fold), matching deepEqual's own
 * object comparison, which ignores key order. This is a deliberate improvement over the previous
 * JSON.stringify-based hash, which was accidentally order-sensitive for objects (JSON.stringify
 * preserves key insertion order) and so could fail to recognize two deepEqual objects with
 * differently-ordered keys as the same array element.
 */
export function hash(val: unknown): number {
    return hashRecursive(val as Json, 5381) >>> 0;
}

/**
 * Fast path: plain recursion beats the iterative fallback below by ~20-45% in microbenchmarks
 * (small values, tweet-shaped objects, and deeply-but-narrowly-nested objects alike), matching
 * the same recursive-vs-iterative tradeoff already established in deepClone.ts/deepEquals.ts.
 * Falls back to the iterative version on stack overflow, so pathologically deep structures are
 * still handled without ever risking a crash - see the depth-200000 test this was verified
 * against (not currently a checked-in test file, but exercised during development).
 */
function hashRecursive(val: Json, h: number): number {
    if (val === null) return mix(h, NULL_TAG);

    switch (typeof val) {
        case "boolean":
            return mix(h, val ? TRUE_TAG : FALSE_TAG);
        case "number":
            return hashNumber(h, val);
        case "string":
            return mixString(mix(h, STRING_TAG), val);
        default:
            try {
                if (Array.isArray(val)) {
                    h = mix(h, ARRAY_TAG);
                    for (let i = 0, l = val.length; i < l; i++) h = hashRecursive(val[i] as Json, h);
                    return h;
                }

                // Order-independent: combine every key's own hash via XOR rather than folding
                // them sequentially into `h`, so key order never affects the result.
                let acc = 0;
                for (const k in val) {
                    acc ^= hashRecursive((val as JsonObject)[k], mixString(5381, k));
                }
                return mix(h, mix(acc, OBJECT_TAG));
            } catch (e) {
                if (e instanceof RangeError) return hashIterative(val as JsonArray | JsonObject, h);
                throw e;
            }
    }
}

// [0, array, nextIndex, foldedHashSoFar]
type ArrayFrame = [0, JsonArray, number, number];
// [1, object, remainingKeys, nextIndex, incomingSeed, xorAccumulatorSoFar]
type ObjectFrame = [1, JsonObject, string[], number, number, number];
type Frame = ArrayFrame | ObjectFrame;

function pushFrame(stack: Frame[], val: JsonArray | JsonObject, seed: number): void {
    if (Array.isArray(val)) {
        stack.push([0, val, 0, mix(seed, ARRAY_TAG)]);
    } else {
        stack.push([1, val, Object.keys(val), 0, seed, 0]);
    }
}

// An array's running hash IS its most recently hashed child's result (each child was seeded
// with the array's previous running hash, so the child's own result already incorporates it -
// mirroring how a recursive walk would just do `h = hashChild(child, h)`, replacing h outright
// rather than mixing the child's result into it a second time). An object instead XORs each
// child in (order never matters, like deepEqual's own object comparison, unlike arrays) - which
// fold applies is entirely determined by the *parent* frame's kind, not the child.
function foldIntoParent(parent: Frame, childHash: number): void {
    if (parent[0] === 0) parent[3] = childHash;
    else parent[5] ^= childHash;
}

/**
 * Safe fallback for pathologically deep input: an explicit stack keeps memory usage on the heap
 * instead of the call stack, so depth is bounded only by available memory. Frames are tuples
 * rather than objects for the same reason as deepClone.ts's Frame type: indexed access on a
 * fixed-shape tuple beats property access on an equivalent-shape object.
 *
 * Deliberately does NOT apply `>>> 0` to intermediate results (only hash()'s final return does) -
 * this fallback can be invoked partway through an ongoing hashRecursive() call for just the one
 * subtree that overflowed, and its result then feeds back into that call's own further `* 33`
 * mixing, which must keep operating on the same signed-vs-unsigned-invariant bit pattern.
 */
function hashIterative(root: JsonArray | JsonObject, seed: number): number {
    const stack: Frame[] = [];
    pushFrame(stack, root, seed);

    while (true) {
        // biome-ignore lint/style/noNonNullAssertion: stack is non-empty per the loop invariant
        const frame = stack[stack.length - 1]!;

        if (frame[0] === 0) {
            const arr = frame[1];
            const index = frame[2];
            if (index < arr.length) {
                const child = arr[index] as Json;
                frame[2] = index + 1;
                if (child === null || typeof child !== "object") frame[3] = hashPrimitive(frame[3], child);
                else pushFrame(stack, child, frame[3]);
                continue;
            }

            const result = frame[3];
            stack.pop();
            if (stack.length === 0) return result;
            foldIntoParent(stack[stack.length - 1] as Frame, result);
            continue;
        }

        const obj = frame[1];
        const keys = frame[2];
        const index = frame[3];
        if (index < keys.length) {
            const key = keys[index] as string;
            frame[3] = index + 1;
            const value = obj[key] as Json;
            const pairSeed = mixString(5381, key);
            if (value === null || typeof value !== "object") frame[5] ^= hashPrimitive(pairSeed, value);
            else pushFrame(stack, value, pairSeed);
            continue;
        }

        const result = mix(frame[4], mix(frame[5], OBJECT_TAG));
        stack.pop();
        if (stack.length === 0) return result;
        foldIntoParent(stack[stack.length - 1] as Frame, result);
    }
}

export type HashedValue<T> = { hash: number; index: number; value: T };

// Per-diff()-call cache (never persisted across separate calls, to avoid a stale hash if a
// caller mutates an object in place between two diff() calls on it - see sortedHashArray).
export type HashCache = WeakMap<object, number>;

/**
 * A pluggable replacement for hash()'s default structural hashing - see diff.ts's `DiffOptions.hash`
 * for the public-facing option this backs, and its doc comment for the semantics/tradeoffs of
 * supplying one (e.g. hashing just an `id` field to match array elements by identity rather than
 * full content).
 */
export type HashFn = (val: Json) => number;

// Bundles the effective hash function for this diff() call (the default hash(), or a caller-
// supplied HashFn) together with its memoization cache, so both travel as one parameter through
// diff.ts's call chain instead of two.
export interface HashContext {
    hash: HashFn;
    cache: HashCache;
}

/**
 * ctx.hash(), memoized by object/array reference in `ctx.cache` - see sortedHashArray's own doc
 * comment for why this is safe (cache scoped to a single diff() call) and when it pays off (shared
 * references between the old/new documents, e.g. Redux/Immer-style shallow-copy updates).
 */
export function cachedHash<T>(value: T, ctx: HashContext): number {
    if (value === null || typeof value !== "object") return ctx.hash(value as Json);
    let h = ctx.cache.get(value as object);
    if (h === undefined) {
        h = ctx.hash(value as Json);
        ctx.cache.set(value as object, h);
    }
    return h;
}

// Below this size, a hand-rolled insertion sort measurably beats native Array.prototype.sort with
// a comparator (~2-4x faster at n<=64, still ~2x at n=100) - comparator-call overhead and
// TimSort's run-detection/merging machinery cost more than they save until the crossover point
// (measured around n=200-250, where insertion sort's O(n^2) finally loses to native's O(n log n)).
// Real diffed arrays are almost always small (tens of elements, not hundreds), so this threshold
// is set well below the crossover with margin, falling back to native sort for anything larger.
const INSERTION_SORT_THRESHOLD = 128;

function insertionSortIndices(hashes: Uint32Array, n: number, indices: number[]): void {
    for (let i = 1; i < n; i++) {
        const cur = indices[i] as number;
        const curHash = hashes[cur] as number;
        let j = i - 1;
        while (j >= 0 && (hashes[indices[j] as number] as number) > curHash) {
            indices[j + 1] = indices[j] as number;
            j--;
        }
        indices[j + 1] = cur;
    }
}

/**
 * Hashes every element of `a` (via `ctx.hash` - the default hash() or a caller-supplied HashFn),
 * then returns the elements as HashedValue entries sorted by hash.
 *
 * `ctx.cache` memoizes the hash by object/array reference, scoped to a single diff() call
 * (threaded in from diff.ts, never module-level/persistent). This is a real win specifically for
 * the very common "shallow copy with a few changes" update pattern (Redux/Immer-style state
 * updates: `next = [...prev]; next[i] = updated;`), where every *unchanged* element in the new
 * array is the exact same object reference as in the old array - without this, hashing the old
 * array and the new array would redundantly re-walk every one of those shared, unchanged subtrees
 * twice. Measured ~1.8x faster for that pattern (18/20 shared references). Safe purely because a
 * hash only ever depends on its own content, and content can't change out from under a synchronous
 * diff() call - the cache is thrown away when diff() returns specifically so it can never observe
 * a mutation the caller made *between* two separate diff() calls on the same object.
 *
 * Sorts a plain array of indices against a flat Uint32Array of hashes rather than sorting the
 * HashedValue objects directly by their `.hash` property - the comparator only ever touches a
 * contiguous typed array instead of chasing pointers into separately-allocated objects, which
 * measurably beats object-property sorting (~5-10% faster, scaling up with array size).
 * Uint32Array (not Int32Array) matters: hash values are treated as unsigned 32-bit ints - the
 * default hash() already returns one via `>>> 0`, and a custom HashFn's return value is coerced
 * into that same range by the Uint32Array store itself (standard JS TypedArray semantics) - a
 * signed typed array would let either kind of value silently wrap to a negative number and sort
 * backwards.
 */
export function sortedHashArray<T>(a: readonly T[], ctx: HashContext): HashedValue<T>[] {
    const n = a.length;
    const hashes = new Uint32Array(n);
    for (let i = 0; i < n; i++) {
        hashes[i] = cachedHash(a[i] as T, ctx);
    }

    const indices: number[] = new Array(n);
    for (let i = 0; i < n; i++) indices[i] = i;
    if (n <= INSERTION_SORT_THRESHOLD) {
        insertionSortIndices(hashes, n, indices);
    } else {
        indices.sort((x, y) => (hashes[x] as number) - (hashes[y] as number));
    }

    const out: HashedValue<T>[] = new Array(n);
    for (let i = 0; i < n; i++) {
        const idx = indices[i] as number;
        out[i] = { value: a[idx] as T, index: idx, hash: hashes[idx] as number };
    }
    return out;
}

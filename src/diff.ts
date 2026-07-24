import { deepEqual } from "./deepEquals";
import type { HashContext, HashFn } from "./hash";
import { cachedHash, hash, sortedHashArray } from "./hash";
import { type Maxi, type Mini, minify } from "./patch";
import { encodeSegment } from "./pointer";
import type { Json, JsonArray, JsonObject } from "./types";
import { hasOwn } from "./utils";

export interface DiffOptions {
    /**
     * A custom hash function to use in place of the default structural hash, for both array
     * element move/copy detection and object-key copy detection. The default hashes a value's
     * full content (so two elements only match if they're actually equal); a custom function lets
     * you match by *identity* instead - the canonical case is extracting a stable `id` field:
     *
     * ```ts
     * diff(oldJson, newJson, { hash: (val) => hash((val as { id: unknown }).id) })
     * ```
     *
     * With this, an array element whose `id` is unchanged but whose other fields differ is
     * diffed as a "move" (or, if it stayed at the same index, an in-place diff of just the
     * changed fields) instead of a "remove" + "add" of the whole value - often a much smaller,
     * more meaningful patch for arrays of records with stable identities that get reordered.
     *
     * Requirements on the function you provide:
     * - It must handle every value shape it can receive (any element of any array being diffed,
     *   plus every object value in the document, for copy detection) - reuse the exported
     *   `hash()` as a fallback for values without an `id` (or whatever field you key on), as the
     *   example above implicitly does for non-object values.
     * - It must be a pure, deterministic function of its argument: the same value must always
     *   hash the same way (across the two calls within a single diff()), and two values that are
     *   deepEqual must still hash equal - hash.ts's `hash()` doc comment goes into why this
     *   direction is required.
     *
     * What you give up: the default hash's structural collision-avoidance. Matching by `id` means
     * two elements that happen to share an `id` (perhaps a real bug in the caller's data) will be
     * treated as "the same element, possibly modified" - diffed against each other - rather than
     * as two unrelated values. This is the intended tradeoff of identity-based matching, not a bug
     * to guard against here; if your `id`s aren't guaranteed unique within an array, the default
     * (no `hash` option) may be a better fit.
     */
    hash?: HashFn;

    /**
     * Transform the output of the diff into a different format.
     */
    transform?: "minify" | "maximize";
}

export function diff(
    oldJson: Json | undefined,
    newJson: Json | undefined,
    options: DiffOptions & { transform: "minify" },
): Mini.Patch;
export function diff(
    oldJson: Json | undefined,
    newJson: Json | undefined,
    options: DiffOptions & { transform: "maximize" },
): Maxi.Patch;
export function diff(oldJson: Json | undefined, newJson: Json | undefined, options?: DiffOptions): Maxi.Patch;
export function diff(
    oldJson: Json | undefined,
    newJson: Json | undefined,
    options?: DiffOptions,
): Maxi.Patch | Mini.Patch {
    // Scoped to this single call - never persisted, so a caller mutating an object in place
    // between two separate diff() calls can never observe a stale cached hash (see hash.ts).
    const hashCtx: HashContext = { hash: options?.hash ?? hash, cache: new WeakMap() };

    const unchanged: Unchanged = { paths: [], hashes: [], values: [] };
    generateUnchanged(oldJson, newJson, unchanged, "", hashCtx);

    const pendingPatch: PendingOp[] = [];
    generateDiff(oldJson, newJson, unchanged, pendingPatch, "", hashCtx);

    // "remove" ops carry their old value only so later "add"s in the same object can be
    // recognised as "move"s - strip it before returning, RFC 6902 removes don't take a value.
    for (let i = 0, l = pendingPatch.length; i < l; i++) {
        const patch = pendingPatch[i] as PendingOp;
        if (patch.op === "remove") delete patch.value;
    }

    const patch = pendingPatch as Maxi.Patch;

    switch (options?.transform) {
        case "minify":
            return minify(patch);
        default:
            return patch;
    }
}

function recordUnchanged(unchanged: Unchanged, hashValue: number, path: string, jsonValue: Json): void {
    unchanged.paths.push(path);
    unchanged.hashes.push(hashValue);
    unchanged.values.push(jsonValue);
}

type UnchangedMatch = { path: string; value: Json };

function findUnchanged(unchanged: Unchanged, hashValue: number): UnchangedMatch | undefined {
    const hashes = unchanged.hashes;
    for (let i = 0, l = hashes.length; i < l; i++) {
        if (hashes[i] === hashValue) {
            return { path: unchanged.paths[i] as string, value: unchanged.values[i] as Json };
        }
    }
    return undefined;
}

function generateUnchanged(
    oldJson: Json | undefined,
    newJson: Json | undefined,
    unchanged: Unchanged,
    path: string,
    hashCtx: HashContext,
): void {
    // deepEqual's signature excludes undefined, but its runtime behavior already handles it
    // correctly (typeof undefined has no case, so it falls through to `a === b`) - this only
    // matters at the document root, since Json itself never contains undefined at any depth.
    if (deepEqual(oldJson as Json, newJson as Json)) {
        recordUnchanged(unchanged, cachedHash(newJson, hashCtx), path, newJson as Json);
        return;
    }

    if (typeof oldJson !== typeof newJson) return;

    // Array unchanged-tracking happens inline during the array diff itself (see transformArray),
    // since it needs the per-element hashes computed there.
    if (Array.isArray(oldJson) && Array.isArray(newJson)) return;

    if (typeof oldJson === "object" && oldJson !== null && typeof newJson === "object" && newJson !== null) {
        try {
            generateUnchangedObject(oldJson as JsonObject, newJson as JsonObject, unchanged, path, hashCtx);
        } catch (e) {
            // A pathologically deep structure overflowed the call stack here - give up tracking
            // "unchanged" (copy-detection) for just this subtree rather than crashing the whole
            // diff() call. Caught here (not at the top level) so only the failing subtree is
            // affected, matching deepClone.ts/deepEquals.ts/hash.ts's recursion-depth handling.
            if (!(e instanceof RangeError)) throw e;
        }
    }
}

function generateUnchangedObject(
    oldJson: JsonObject,
    newJson: JsonObject,
    unchanged: Unchanged,
    path: string,
    hashCtx: HashContext,
): void {
    const oldKeys = Object.keys(oldJson);
    for (let i = 0, l = oldKeys.length; i < l; i++) {
        const key = oldKeys[i] as string;
        if (hasOwn(newJson, key)) {
            generateUnchanged(oldJson[key], newJson[key], unchanged, `${path}/${encodeSegment(key)}`, hashCtx);
        }
    }
}

function generateDiff(
    oldJson: Json | undefined,
    newJson: Json | undefined,
    unchanged: Unchanged,
    patches: PendingOp[],
    path: string,
    hashCtx: HashContext,
): void {
    if (Array.isArray(oldJson) && Array.isArray(newJson)) {
        try {
            generateArrayDiff(oldJson, newJson, unchanged, patches, path, hashCtx);
        } catch (e) {
            if (!(e instanceof RangeError)) throw e;
            generateDeepFallback(oldJson, newJson, patches, path);
        }
        return;
    }

    if (typeof oldJson === "object" && oldJson !== null && typeof newJson === "object" && newJson !== null) {
        try {
            generateObjectDiff(oldJson as JsonObject, newJson as JsonObject, unchanged, patches, path, hashCtx);
        } catch (e) {
            if (!(e instanceof RangeError)) throw e;
            generateDeepFallback(oldJson, newJson, patches, path);
        }
        return;
    }

    generateValueDiff(oldJson, newJson, patches, path);
}

// A pathologically deep structure overflowed the call stack while diffing this subtree
// granularly. Caught here (each recursive generateDiff() call has its own try/catch, not just
// the top-level one) so only this specific subtree falls back, leaving every sibling/ancestor
// already-processed part of the document with its normal, fully granular diff - matching how
// deepClone.ts/deepEquals.ts/hash.ts localize their own recursion-depth fallbacks. deepEqual is
// itself stack-safe (recursive+iterative-fallback), so this is guaranteed not to also overflow.
function generateDeepFallback(oldJson: Json, newJson: Json, patches: PendingOp[], path: string): void {
    if (!deepEqual(oldJson, newJson)) patches.push({ op: "replace", path, value: newJson });
}

function generateValueDiff(
    oldJson: Json | undefined,
    newJson: Json | undefined,
    patches: PendingOp[],
    path: string,
): void {
    if (newJson !== oldJson) patches.push({ op: "replace", path, value: newJson as Json });
}

function generateObjectDiff(
    oldJson: JsonObject,
    newJson: JsonObject,
    unchanged: Unchanged,
    patches: PendingOp[],
    path: string,
    hashCtx: HashContext,
): void {
    const oldKeys = Object.keys(oldJson);
    const newKeys = Object.keys(newJson);
    let removed = false;

    for (let i = oldKeys.length - 1; i >= 0; i--) {
        const oldKey = oldKeys[i] as string;
        const oldValue = oldJson[oldKey];

        if (hasOwn(newJson, oldKey)) {
            generateDiff(oldValue, newJson[oldKey], unchanged, patches, `${path}/${encodeSegment(oldKey)}`, hashCtx);
        } else {
            removed = true;
            patches.push({ op: "remove", path: `${path}/${encodeSegment(oldKey)}`, value: oldValue });
        }
    }

    // Nothing was removed and no keys were added - the objects have identical key sets.
    if (!removed && newKeys.length === oldKeys.length) return;

    for (let i = 0, l = newKeys.length; i < l; i++) {
        const newKey = newKeys[i] as string;
        if (hasOwn(oldJson, newKey)) continue;

        const newVal = newJson[newKey];

        // Skip hashing newVal entirely when there's nothing it could possibly match - hashing
        // walks newVal's full structure, which is wasted work when findUnchanged can only ever
        // return undefined anyway (checked here, not inside findUnchanged, since only the caller
        // can avoid computing the hash argument in the first place).
        if (unchanged.hashes.length > 0) {
            const match = findUnchanged(unchanged, cachedHash(newVal, hashCtx));
            if (match !== undefined) {
                const newPath = `${path}/${encodeSegment(newKey)}`;
                patches.push({ op: "copy", path: newPath, from: match.path });
                // With the default hash() a match here is guaranteed deepEqual (astronomically
                // rare collisions aside), but a caller-supplied DiffOptions.hash may deliberately
                // match by identity rather than content (e.g. an `id` field) - so the matched
                // value isn't necessarily equal to newVal. Correct any actual difference with a
                // nested diff instead of silently keeping the copied source's stale content.
                if (!deepEqual(match.value, newVal)) {
                    generateDiff(match.value, newVal, unchanged, patches, newPath, hashCtx);
                }
                continue;
            }
        }

        const previousIndex = findValueInPatch(newVal, patches);
        const previous = previousIndex !== -1 ? patches[previousIndex] : undefined;

        if (previous !== undefined && previous.op === "remove") {
            const oldPath = previous.path;
            patches.splice(previousIndex, 1);
            patches.push({ op: "move", from: oldPath, path: `${path}/${encodeSegment(newKey)}` });
        } else {
            patches.push({ op: "add", path: `${path}/${encodeSegment(newKey)}`, value: newVal });
        }
    }
}

function findValueInPatch(newValue: Json | undefined, patches: PendingOp[]): number {
    for (let i = 0, l = patches.length; i < l; i++) {
        const p = patches[i];
        if ("value" in p && p.value === newValue) return i;
    }
    return -1;
}

type ArrOp = "add" | "remove" | "move" | "replace" | "copy";

interface ArrPatch {
    op: ArrOp;
    value?: Json;
    valueOld?: Json;
    from?: number;
    index: number;
    hash?: number;
    // How many arrtmp entries this element's own processing pushed - normally 1 (just its own
    // op), but a "move"/"copy" whose matched value wasn't actually deepEqual (only possible with
    // a custom identity-based DiffOptions.hash) also pushes correction ops right after it. The
    // "remove immediately after a move" collapse below needs this to remove the *whole* group,
    // not just the last entry, when it un-does a move that also carried corrections.
    opCount?: number;
}

function generateArrayDiff(
    oldJson: JsonArray,
    newJson: JsonArray,
    unchanged: Unchanged,
    patches: PendingOp[],
    path: string,
    hashCtx: HashContext,
): void {
    if (oldJson.length === 0 && newJson.length === 0) return;

    if (oldJson.length === 0) {
        patches.push({ op: "add", path, value: newJson });
        return;
    }

    // Cheap short-circuit: skip the hash+sort+match machinery entirely when the whole array is
    // unchanged. Extremely common in practice - e.g. a sibling scalar field changed on the parent
    // object, triggering a nested diff, while this array itself never did (measured: 100% of
    // nested arrays visited within changed real-dataset records were themselves fully unchanged).
    if (deepEqual(oldJson, newJson)) return;

    const arrayPatches = transformArray(oldJson, newJson, unchanged, path, hashCtx);
    for (let i = 0, l = arrayPatches.length; i < l; i++) {
        patches.push(arrayPatches[i] as PendingOp);
    }
}

function transformArray(
    oldJson: JsonArray,
    newJson: JsonArray,
    unchanged: Unchanged,
    path: string,
    hashCtx: HashContext,
): PendingOp[] {
    // Sort by hash so equal (or nearly-equal) elements from both sides line up next to each
    // other, turning the diff into a single merge pass instead of an O(n*m) comparison.
    const xSorted = sortedHashArray(oldJson, hashCtx);
    const ySorted = sortedHashArray(newJson, hashCtx);

    const arrPatch: ArrPatch[] = [];
    // Same rationale as `Unchanged` above: a handful of entries at most, so a plain array
    // scanned linearly beats a Map's setup cost at this scale.
    const arrUnchanged: ArrPatch[] = [];
    const arrtmp: PendingOp[] = [];

    let i = 0;
    let j = 0;

    while (i < xSorted.length) {
        while (j < ySorted.length) {
            const x = xSorted[i];
            const y = ySorted[j];
            if (x !== undefined) {
                if (x.hash > y.hash) {
                    arrPatch.push({ op: "add", value: y.value, index: y.index, hash: y.hash });
                    j++;
                } else if (x.hash === y.hash) {
                    recordUnchanged(unchanged, x.hash, `${path}/${y.index}`, y.value as Json);
                    arrPatch.push({
                        op: "move",
                        value: y.value,
                        valueOld: x.value,
                        from: x.index,
                        index: y.index,
                        hash: y.hash,
                    });
                    i++;
                    j++;
                } else {
                    arrPatch.push({ op: "remove", index: x.index, value: x.value });
                    i++;
                }
            } else {
                arrPatch.push({ op: "add", value: y.value, index: y.index, hash: y.hash });
                j++;
            }
        }

        if (i < xSorted.length) {
            const x = xSorted[i];
            arrPatch.push({ op: "remove", index: x.index, value: x.value });
            i++;
        }
    }

    // Order: move < remove < add < replace < copy, ties broken by target index.
    if (arrPatch.length <= ARR_PATCH_INSERTION_SORT_THRESHOLD) {
        insertionSortArrPatch(arrPatch);
    } else {
        arrPatch.sort(compareArrPatch);
    }

    let m = 0;
    while (arrPatch[m] !== undefined) {
        const current = arrPatch[m] as ArrPatch;

        // current.op is always "add"/"remove"/"move" here - an entry reassigned to "replace"/
        // "copy" below is spliced out or continue's past re-entering this switch, so those two
        // ArrOp variants never reach it (no default case needed).
        switch (current.op) {
            case "add": {
                current.index = transformIndex(current, m, arrPatch);

                const prev = arrPatch[m - 1];
                if (prev !== undefined && prev.op === "remove" && prev.index === current.index) {
                    // A remove immediately followed by an add at the same index is a replace -
                    // recurse into it when both sides are objects/arrays so nested diffs are minimal.
                    if (
                        typeof prev.value === "object" &&
                        prev.value !== null &&
                        typeof current.value === "object" &&
                        current.value !== null
                    ) {
                        const tmPatch: PendingOp[] = [];
                        generateDiff(prev.value, current.value, unchanged, tmPatch, `${path}/${prev.index}`, hashCtx);
                        current.op = "replace";
                        arrPatch.splice(m - 1, 1);
                        arrtmp.pop();
                        arrtmp.push(...tmPatch);
                        continue;
                    }

                    current.op = "replace";
                    arrPatch.splice(m - 1, 1);
                    arrtmp.pop();
                    arrtmp.push({ op: "replace", value: current.value as Json, path: `${path}/${current.index}` });
                    continue;
                }

                // copyMatch.index is always strictly less than current.index (a copy source is
                // always something already resolved at an earlier position by the time this add
                // is being placed - RFC6902 patches apply sequentially, so there's nothing to copy
                // "from" at a not-yet-reached position) - so unlike the move case above, there's
                // no same-position no-op to collapse here.
                const copyMatch = findCopyInArray(current, m, arrPatch, arrUnchanged);
                if (copyMatch !== undefined) {
                    current.op = "copy";
                    current.from = copyMatch.index;
                    const newPath = `${path}/${current.index}`;
                    arrtmp.push({ op: "copy", from: `${path}/${current.from}`, path: newPath });
                    // See generateObjectDiff's identical check: with the default hash() this
                    // match is guaranteed deepEqual, but a custom identity-based DiffOptions.hash
                    // can match by id rather than content - correct any real difference instead of
                    // silently keeping the copy source's stale content.
                    if (!deepEqual(copyMatch.value, current.value as Json)) {
                        generateDiff(copyMatch.value, current.value as Json, unchanged, arrtmp, newPath, hashCtx);
                    }
                } else {
                    arrtmp.push({ op: "add", value: current.value as Json, path: `${path}/${current.index}` });
                }
                break;
            }
            case "remove": {
                current.index = transformIndex(current, m, arrPatch);

                const prev = arrPatch[m - 1];
                if (
                    prev !== undefined &&
                    prev.op === "move" &&
                    prev.from === current.index &&
                    prev.from === prev.index + 1 &&
                    // This collapse's correctness relies on the index arithmetic alone (it never
                    // checks that the move and this remove target the same conceptual element) -
                    // that's safe with the default hash(), where a move can never carry a
                    // correction (opCount is always 1). A custom identity-based DiffOptions.hash
                    // can produce a move *with* a correction whose index arithmetic still happens
                    // to satisfy this pattern purely by coincidence, against a remove that's
                    // actually unrelated to it - collapsing then would silently discard both the
                    // correction and the real element being removed, so skip the collapse whenever
                    // the move isn't a plain single op. prev.opCount is never undefined here (only
                    // a "different index" move survives to be checked as `prev` - the same-index
                    // case splices itself out of arrPatch instead - and that branch always sets it).
                    prev.opCount === 1
                ) {
                    // A move of x->x+1 followed by removing x+1 is just removing x.
                    current.index = prev.index;
                    arrPatch.splice(m - 1, 1);
                    arrtmp.pop();
                    arrtmp.push({ op: "remove", path: `${path}/${prev.index}` });
                    continue;
                }

                arrtmp.push({ op: "remove", path: `${path}/${current.index}` });
                break;
            }
            case "move": {
                current.from = transformIndex(current, m, arrPatch);

                if (current.index === current.from) {
                    // deepEqual walks both values directly and can bail out on the first
                    // mismatch, unlike JSON.stringify which must fully serialize both sides
                    // (two full-size string allocations) before it can even compare them.
                    if (deepEqual(current.valueOld as Json, current.value as Json)) {
                        arrUnchanged.push(current);
                        arrPatch.splice(m, 1);
                        continue;
                    }

                    // Same index, different value - diff the two values in place instead of moving.
                    const tmMove: PendingOp[] = [];
                    generateDiff(
                        current.valueOld,
                        current.value,
                        unchanged,
                        tmMove,
                        `${path}/${current.index}`,
                        hashCtx,
                    );
                    arrPatch.splice(m, 1);
                    arrtmp.push(...tmMove);
                    continue;
                }

                const newPath = `${path}/${current.index}`;
                const moveOpsStart = arrtmp.length;
                arrtmp.push({ op: "move", from: `${path}/${current.from}`, path: newPath });
                // With the default hash() a hash-matched move pair is guaranteed deepEqual, but a
                // custom identity-based DiffOptions.hash can match an element to a new position
                // even though its content also changed - correct any real difference at the
                // destination instead of silently keeping the pre-move content (same reasoning as
                // the same-index case above, and the copy corrections in generateObjectDiff and
                // the "add" case just above).
                if (!deepEqual(current.valueOld as Json, current.value as Json)) {
                    generateDiff(current.valueOld, current.value, unchanged, arrtmp, newPath, hashCtx);
                }
                current.opCount = arrtmp.length - moveOpsStart;
                break;
            }
        }

        m++;
    }

    return arrtmp;
}

// Adjusts an element's original index to account for every operation processed before it,
// since earlier inserts/removes/moves shift where this element now actually sits.
//
// `element` is always "add"/"remove"/"move" at the call site (the main loop only calls this from
// within those three cases, passing `current` whose op the outer switch already dispatched on) -
// "replace"/"copy" can't reach here, so the first switch below only handles those three.
function transformIndex(element: ArrPatch, m: number, array: ArrPatch[]): number {
    let finalIndex: number;

    switch (element.op as "add" | "remove" | "move") {
        case "add":
            return element.index;
        case "remove":
            finalIndex = element.index;
            break;
        case "move":
            finalIndex = element.from as number;
            break;
    }

    for (let i = 0; i < m; i++) {
        const other = array[i];
        switch (other.op) {
            case "remove":
                if (finalIndex > other.index) finalIndex--;
                break;
            case "add":
            case "copy":
                // finalIndex < other.index (no shift needed) was checked for but never observed
                // across an exhaustive enumeration of every array pair up to length 5 over a
                // 3-symbol id alphabet (132k+ pairs), plus 2M+ further randomized/permutation-
                // based samples specifically constructed (via DiffOptions.hash's id-matching) to
                // maximize add/copy interactions - so unlike the "remove" case just above (which
                // does take both branches), an already-processed add/copy at i < m always sits at
                // or before this element's own position.
                finalIndex++;
                break;
            case "replace":
                break;
            case "move": {
                // from === other.index can't reach here either: a move whose from and target
                // coincide is always spliced out of arrPatch (collapsed to "unchanged" or an
                // in-place diff) before m advances past it, so it can never later be seen as an
                // already-processed `other` entry the way a genuine move can.
                const from = other.from as number;
                const min = Math.min(from, other.index);
                const max = Math.max(from, other.index);
                if (finalIndex >= min && finalIndex <= max) {
                    // from > other.index (the "shift forward" case) was, like the add/copy branch
                    // above, checked for but never observed across the same exhaustive-plus-
                    // randomized search (13M+ sampled move interactions) - an already-processed
                    // move's source position never sits at or before its own target here.
                    finalIndex++;
                }
                break;
            }
        }
    }

    return finalIndex;
}

// compareArrPatch (and therefore operationValue) only ever runs before the main processing loop
// below reassigns an entry's op to "replace"/"copy" - the sort happens once, up front, on entries
// that are still exclusively "add"/"remove"/"move" - so those two ArrOp variants can't reach here.
type SortableArrOp = "add" | "remove" | "move";

function operationValue(op: SortableArrOp): number {
    switch (op) {
        case "move":
            return 0;
        case "remove":
            return 1;
        case "add":
            return 2;
    }
}

function compareArrPatch(a: ArrPatch, b: ArrPatch): number {
    if (a.index === b.index) {
        return operationValue(a.op as SortableArrOp) > operationValue(b.op as SortableArrOp) ? 1 : -1;
    }
    return a.index - b.index;
}

// Below this size, insertion sort measurably beats native Array.prototype.sort with a comparator
// (~1.6-2.8x faster at n<=25 in isolation) - same reasoning as hash.ts's INSERTION_SORT_THRESHOLD,
// applied here since arrPatch is typically even smaller than the source array (only entries for
// actually-changed elements).
const ARR_PATCH_INSERTION_SORT_THRESHOLD = 128;

function insertionSortArrPatch(arr: ArrPatch[]): void {
    for (let i = 1, l = arr.length; i < l; i++) {
        const cur = arr[i] as ArrPatch;
        let j = i - 1;
        while (j >= 0 && compareArrPatch(arr[j] as ArrPatch, cur) > 0) {
            arr[j + 1] = arr[j] as ArrPatch;
            j--;
        }
        arr[j + 1] = cur;
    }
}

// Only ever called with `element.op === "add"` (see the "add" case in transformArray's main
// loop, which never reassigns current.op before this call) - no need to guard against
// "remove"/"copy" ops that can never actually reach here.
type ArrCopyMatch = { index: number; value: Json };

function findCopyInArray(
    element: ArrPatch,
    m: number,
    array: ArrPatch[],
    arrUnchanged: ArrPatch[],
): ArrCopyMatch | undefined {
    for (let i = 0; i < m; i++) {
        const other = array[i] as ArrPatch;
        if (element.hash === other.hash) return { index: other.index, value: other.value as Json };
    }

    for (let i = 0, l = arrUnchanged.length; i < l; i++) {
        const u = arrUnchanged[i] as ArrPatch;
        if (element.hash === u.hash) return { index: u.index, value: u.value as Json };
    }

    return undefined;
}

type PendingOp = Maxi.AddOp | (Maxi.RemoveOp & { value?: Json }) | Maxi.ReplaceOp | Maxi.MoveOp | Maxi.CopyOp;

// Paths where the old and new documents agree, used to detect copies: parallel arrays (path,
// hash, value) rather than an array of "path=hash" strings, so a lookup is a plain number
// comparison with no separator-parsing/slicing on every entry. Real diffs only ever have a
// handful of these, so plain arrays scanned linearly beat a Map here - the constant-factor cost of
// hashing into a Map and allocating its buckets outweighs the O(1) lookup at this scale.
//
// `values` exists purely so a hash match can be verified with deepEqual before trusting it as a
// genuine copy (see the "copy" handling in generateObjectDiff and transformArray's "add" case) -
// with the default hash(), two deepEqual values are guaranteed to hash the same and a genuine
// collision is astronomically rare, but a caller-supplied DiffOptions.hash (e.g. matching by an
// `id` field) can deliberately hash two *different* values the same way - without this check,
// that would silently emit a "copy" that drops the differing content instead of preserving it.
type Unchanged = { paths: string[]; hashes: number[]; values: Json[] };

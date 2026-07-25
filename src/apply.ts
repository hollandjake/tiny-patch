import { deepClone } from "./deepClone";
import { deepEquals } from "./deepEquals";
import { InvalidOperationError, TestError } from "./error";
import { maximize, type Patch } from "./patch";
import { decodePointer, evaluatePointer } from "./pointer";
import type { Json, JsonObject } from "./types";
import { hasOwn } from "./utils";

export interface ApplyOptions {
    /**
     * When a "move" op renames a key within the same parent object, preserve the key's original
     * position instead of moving it to the end (the plain remove+add behavior). Disabled by
     * default since it costs an extra rebuild of the parent object.
     */
    preserveKeyOrder?: boolean;
}

/**
 * @param target - The object to apply a patch to
 * @param patch - The patch to apply
 * @param options - Options controlling how the patch is applied
 */
export function apply(target: Json | undefined, patch: Patch, options?: ApplyOptions): Json | undefined {
    const maxiPatch = maximize(patch);
    const numPatches = maxiPatch.length;

    // Create a deep copy of the object
    let result = deepClone(target);

    if (numPatches === 0) return result;

    const preserveKeyOrder = options?.preserveKeyOrder ?? false;

    for (let i = 0, l = numPatches; i < l; i++) {
        const op = maxiPatch[i];
        switch (op.op) {
            case "add":
                result = add(result, op.path, op.value);
                break;
            case "remove":
                result = remove(result, op.path);
                break;
            case "replace":
                result = replace(result, op.path, op.value);
                break;
            case "move":
                result = move(result, op.from, op.path, preserveKeyOrder);
                break;
            case "copy":
                result = copy(result, op.from, op.path);
                break;
            case "test":
                result = test(result, op.path, op.value);
                break;
            default:
                throw new InvalidOperationError(op);
        }
    }

    return result;
}

function add(target: Json | undefined, path: string, value: Json): Json | undefined {
    const tokens = decodePointer(path);
    value = deepClone(value);

    const [obj, key] = evaluatePointer(tokens, target);

    return addAt(target, tokens, obj, key, value);
}

// Inserts an already-resolved [obj, key] pair without re-decoding/re-walking the pointer. Shared by
// add() and move(), the latter of which already owns a uniquely-referenced value and so skips the
// deepClone that add() applies before calling this.
function addAt(
    target: Json | undefined,
    tokens: string[],
    obj: Json | undefined,
    key: string | number | undefined,
    value: Json,
): Json | undefined {
    if (tokens.length === 0 && key === undefined) return value;

    if (Array.isArray(obj)) {
        // evaluatePointer() always resolves "-" to an explicit numeric index before returning
        // (this is the only way addAt() is ever called), so key is never the literal "-" here.
        obj.splice(key as number, 0, value);
    } else {
        // The tokens.length === 0 check above is the only way key could be undefined here (every
        // caller passes evaluatePointer()'s own output, which only ever leaves key undefined when
        // tokens.length is 0 too) - so key is always defined at this point.
        // biome-ignore lint/style/noNonNullAssertion: We expect it to error here
        obj![key as keyof typeof obj] = value as never;
    }

    return target;
}

function remove(target: Json | undefined, path: string): Json | undefined {
    const tokens = decodePointer(path);

    // The target is the root, so deleting it would result in a becoming undefined
    if (tokens.length === 0) return undefined;

    const [obj, key] = evaluatePointer(tokens, target, true);

    return removeAt(target, tokens, obj, key);
}

// Removes an already-resolved [obj, key] pair without re-decoding/re-walking the pointer. Shared by
// remove() and move(), which resolves "from" itself upfront and would otherwise redo the same work.
function removeAt(
    target: Json | undefined,
    tokens: string[],
    obj: Json | undefined,
    key: string | number | undefined,
): Json | undefined {
    if (tokens.length === 0) return undefined;

    if (Array.isArray(obj)) {
        // evaluatePointer() always resolves "-" to an explicit numeric index before returning
        // (this is the only way removeAt() is ever called), so key is never the literal "-" here.
        obj.splice(key as number, 1);
    } else {
        // Same reasoning as addAt(): the tokens.length === 0 check above guarantees key is
        // defined here, since every caller passes evaluatePointer()'s own output.
        delete obj?.[key as never];
    }

    return target;
}

function replace(target: Json | undefined, path: string, value: Json): Json | undefined {
    const tokens = decodePointer(path);
    value = deepClone(value);

    // The target is the root, so replace it would result in the value
    if (tokens.length === 0) return value;

    const [obj, key] = evaluatePointer(tokens, target);

    // The tokens.length === 0 check above guarantees key is defined here (evaluatePointer only
    // ever leaves it undefined when tokens.length is 0 too).
    // biome-ignore lint/style/noNonNullAssertion: We expect it to error here
    obj![key as keyof typeof obj] = value as never;

    return target;
}

function move(target: Json | undefined, from: string, to: string, preserveKeyOrder: boolean): Json | undefined {
    const fromTokens = decodePointer(from);
    const toTokens = decodePointer(to);

    const [fromParent, fromKey, fromValue] = evaluatePointer(fromTokens, target, true);

    // If both from and to point to the same parent object, then instead of a remove and add, we perform an inplace rename,
    // preserving the order of the keys
    if (preserveKeyOrder) {
        const [toParent, toKey] = evaluatePointer(toTokens, target);

        if (
            fromParent &&
            fromParent === toParent &&
            typeof fromParent === "object" &&
            !Array.isArray(fromParent) &&
            typeof fromKey === "string" &&
            typeof toKey === "string" &&
            (fromKey === toKey || !hasOwn(fromParent, toKey))
        ) {
            // Renaming a key onto itself is a no-op - skip the rebuild entirely
            if (fromKey === toKey) return target;

            const renamed: JsonObject = {};
            for (const key in fromParent) renamed[key === fromKey ? toKey : key] = fromParent[key];

            // fromParent is the document root itself, so the rebuilt object simply becomes the new root
            if (fromTokens.length === 1) return renamed;

            // fromParent is nested: splice the rebuilt object back into its own parent's slot instead
            // of returning it as if it were the whole document, which would orphan it from the tree
            const [grandParent, grandKey] = evaluatePointer(fromTokens.slice(0, -1), target);
            // biome-ignore lint/style/noNonNullAssertion: grandParent must exist, we already walked this path above
            grandParent![grandKey as keyof typeof grandParent] = renamed as never;
            return target;
        }
    }

    // Remove from the location we already resolved above - no need to re-decode/re-walk "from"
    const removed = removeAt(target, fromTokens, fromParent, fromKey);

    // "to" must be resolved against the post-removal tree (removing from an array can shift indices
    // that "to" passes through), so it can't reuse a pre-removal resolution
    const [toParent, toKey] = evaluatePointer(toTokens, removed);

    // fromValue was just extracted above, so it's already uniquely owned - addAt() (unlike add())
    // skips the deepClone that would otherwise be redundant here
    return addAt(removed, toTokens, toParent, toKey, fromValue);
}

function copy(target: Json | undefined, from: string, to: string): Json | undefined {
    const fromTokens = decodePointer(from);
    const [, , value] = evaluatePointer(fromTokens, target, true);
    return add(target, to, value);
}

function test(target: Json | undefined, path: string, test: Json | undefined): Json | undefined {
    const tokens = decodePointer(path);
    const [, , value] = evaluatePointer(tokens, target, true);

    if (!deepEquals(value, test)) throw new TestError(value, test);

    return target;
}

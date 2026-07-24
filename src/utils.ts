// Unbound Object.prototype.hasOwnProperty.call(...) measured faster than both `in` (which also
// walks the prototype chain, doing unnecessary work here since we only care about own keys) and
// Object.hasOwn in Bun's JavaScriptCore.
const objectHasOwnProperty = Object.prototype.hasOwnProperty;
export function hasOwn(obj: object, key: string | number): boolean {
    return objectHasOwnProperty.call(obj, key);
}

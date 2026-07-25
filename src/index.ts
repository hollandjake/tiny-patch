export { type ApplyOptions, apply } from "./apply";
export { deepClone } from "./deepClone";
export { deepEquals } from "./deepEquals";
export { type DiffOptions, diff } from "./diff";
export { InvalidOperationError, InvalidPatchError, MissingError, PointerError, TestError } from "./error";
export { type HashFn, hash } from "./hash";
export { isMaximised, isMinified, type Maxi, type Mini, maximize, minify, type Op, type Patch } from "./patch";
export { decodePointer, decodeSegment, encodePointer, encodeSegment } from "./pointer";
export type * from "./types";

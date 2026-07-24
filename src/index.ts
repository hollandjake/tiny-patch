import { apply } from "./apply";
import { diff } from "./diff";
import { hash } from "./hash";
import { isMaximised, isMinified, maximize, minify } from "./patch";
import { decodePointer, decodeSegment, encodePointer, encodeSegment } from "./pointer";

export type { ApplyOptions } from "./apply";
export type { DiffOptions } from "./diff";
export type { HashFn } from "./hash";
export type { Maxi, Mini, Op, Patch } from "./patch";
export {
    apply,
    decodePointer,
    decodeSegment,
    diff,
    encodePointer,
    encodeSegment,
    hash,
    isMaximised,
    isMinified,
    maximize,
    minify,
};

export default {
    apply,
    decodePointer,
    decodeSegment,
    diff,
    encodePointer,
    encodeSegment,
    hash,
    isMaximised,
    isMinified,
    maximize,
    minify,
};

import { type ApplyOptions, apply } from "./apply";
import { type DiffOptions, diff } from "./diff";
import { type HashFn, hash } from "./hash";

export type { Maxi, Mini, Op, Patch } from "./patch";
export { type ApplyOptions, apply, type DiffOptions, diff, type HashFn, hash };

export default { apply, diff, hash };

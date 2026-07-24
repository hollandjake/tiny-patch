import { InvalidOperationError, InvalidPatchError } from "./error";
import type { Json } from "./types";

declare namespace Maxi {
    type AddOp = {
        op: "add";
        path: string;
        value: Json;
    };
    type RemoveOp = {
        op: "remove";
        path: string;
    };
    type ReplaceOp = {
        op: "replace";
        path: string;
        value: Json;
    };
    type MoveOp = {
        op: "move";
        from: string;
        path: string;
    };
    type CopyOp = {
        op: "copy";
        from: string;
        path: string;
    };
    type TestOp = {
        op: "test";
        path: string;
        value: Json;
    };
    type Op = AddOp | RemoveOp | ReplaceOp | MoveOp | CopyOp | TestOp;
    type Patch = Op[];
}

export namespace Mini {
    export type AddOp = [op: "+", path: string, value: Json];
    export type RemoveOp = [op: "-", path: string];
    export type ReplaceOp = [op: "~", path: string, value: Json];
    export type MoveOp = [op: ">", from: string, to: string];
    export type CopyOp = [op: "^", from: string, to: string];
    export type TestOp = [op: "?", path: string, value: Json];
    export type Op = AddOp | RemoveOp | ReplaceOp | MoveOp | CopyOp | TestOp;
    export type Patch = Op[];
}

export type { Maxi };

export type Op = Mini.Op | Maxi.Op;
export type Patch = Op[];

export function minify(patch: Patch): Mini.Patch {
    if (!Array.isArray(patch)) throw new InvalidPatchError(patch);
    return patch.map(minifyOp);
}

export function minifyOp(op: Op): Mini.Op {
    if (isMinified(op)) return op;
    if (!isMaximised(op)) throw new InvalidOperationError(op);
    switch (op.op) {
        case "add":
            return ["+", op.path, op.value];
        case "remove":
            return ["-", op.path];
        case "replace":
            return ["~", op.path, op.value];
        case "move":
            return [">", op.from, op.path];
        case "copy":
            return ["^", op.from, op.path];
        case "test":
            return ["?", op.path, op.value];
    }
}

export function maximize(patch: Patch): Maxi.Patch {
    if (!Array.isArray(patch)) throw new InvalidPatchError(patch);
    return patch.map(maximizeOp);
}

export function maximizeOp(op: Op): Maxi.Op {
    if (isMaximised(op)) return op;
    if (!isMinified(op)) throw new InvalidOperationError(op);
    switch (op[0]) {
        case "+":
            return { op: "add", path: op[1], value: op[2] };
        case "-":
            return { op: "remove", path: op[1] };
        case "~":
            return { op: "replace", path: op[1], value: op[2] };
        case ">":
            return {
                op: "move",
                from: op[1],
                path: op[2],
            };
        case "^":
            return {
                op: "copy",
                from: op[1],
                path: op[2],
            };
        case "?":
            return { op: "test", path: op[1], value: op[2] };
    }
}

export function isMinified(op: Op): op is Mini.Op {
    if (!op) return false;
    if (!Array.isArray(op)) return false;
    if (!op.length) return false;

    switch (op[0]) {
        case "+":
        case "~":
        case "?":
            return op.length >= 3 && isPointerable(op[1]);
        case "-":
            return op.length >= 2 && isPointerable(op[1]);
        case ">":
        case "^":
            return op.length >= 3 && isPointerable(op[1]) && isPointerable(op[2]);
        default:
            return false;
    }
}

export function isMaximised(op: Op): op is Maxi.Op {
    if (!op) return false;
    if (typeof op !== "object") return false;
    if (!("op" in op)) return false;
    if (!("path" in op)) return false;

    switch (op.op) {
        case "add":
        case "replace":
        case "test":
            return isPointerable(op.path) && "value" in op;
        case "remove":
            return isPointerable(op.path);
        case "move":
        case "copy":
            return isPointerable(op.path) && "from" in op && isPointerable(op.from);
        default:
            return false;
    }
}

function isPointerable(x: unknown): x is string {
    return typeof x === "string";
}

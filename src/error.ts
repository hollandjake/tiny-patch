import type { Maxi } from "./patch";

export class PointerError extends Error {}

export class MissingError extends Error {
    constructor(public tokens: string[]) {
        super(`Value required at path: '${tokens}'`);
        this.name = "MissingError";
    }
}

export class TestError extends Error {
    constructor(
        public actual: unknown,
        public expected: unknown,
    ) {
        super(`Test failed: '${actual}' !== '${expected}'`);
        this.name = "TestError";
    }
}

export class InvalidOperationError extends Error {
    constructor(public op: Maxi.Op) {
        super(`Invalid operation: '${JSON.stringify(op)}'`);
        this.name = "InvalidOperationError";
    }
}

export class InvalidPatchError extends Error {
    constructor(public patch: unknown) {
        super(`Invalid patch: '${patch}'`);
        this.name = "InvalidPatchError";
    }
}

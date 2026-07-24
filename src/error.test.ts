import { describe, expect, test } from "vitest";
import { InvalidOperationError, MissingError, PointerError, TestError } from "./error";

describe("PointerError", () => {
    test("is a plain Error subclass carrying the given message", () => {
        const err = new PointerError("Invalid key 'a' for 1");
        expect(err).toBeInstanceOf(Error);
        expect(err.message).toBe("Invalid key 'a' for 1");
    });
});

describe("MissingError", () => {
    test("carries the tokens and formats them into the message", () => {
        const err = new MissingError(["a", "b"]);
        expect(err).toBeInstanceOf(Error);
        expect(err.name).toBe("MissingError");
        expect(err.tokens).toEqual(["a", "b"]);
        expect(err.message).toBe("Value required at path: 'a,b'");
    });
});

describe("TestError", () => {
    test("carries the actual and expected values and formats them into the message", () => {
        const err = new TestError(1, 2);
        expect(err).toBeInstanceOf(Error);
        expect(err.name).toBe("TestError");
        expect(err.actual).toBe(1);
        expect(err.expected).toBe(2);
        expect(err.message).toBe("Test failed: '1' !== '2'");
    });
});

describe("InvalidOperationError", () => {
    test("carries the offending op and formats it into the message", () => {
        const op = { op: "INVALID", path: "/a" } as never;
        const err = new InvalidOperationError(op);
        expect(err).toBeInstanceOf(Error);
        expect(err.name).toBe("InvalidOperationError");
        expect(err.op).toBe(op);
        expect(err.message).toBe(`Invalid operation: '${JSON.stringify(op)}'`);
    });
});

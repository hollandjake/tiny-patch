import fs from "node:fs/promises";
import path from "node:path";
import jsonpatch from "fast-json-patch";
// @ts-expect-error
import jiff from "jiff";
// @ts-expect-error
import jdr from "json-diff-rfc6902";
// @ts-expect-error
import hashObject from "json-diff-rfc6902/lib/hashObject.js";
// @ts-expect-error
import json8 from "json8-patch";
import rfc6902 from "rfc6902";
// @ts-expect-error
import hashToNum from "string-hash";
import tinypatch, { type Patch } from "tiny-patch";

// json-diff-rfc6902 always falls back to obj.id/_id/answer_id/title as an implicit identity
// key before hashing full content - even with no HASH_ID option passed - which lets it match
// array elements across content changes for free. tinypatch's hash is intentionally pure
// content-based with no such heuristic (see memory: feedback-hash-no-heuristics), so this
// patches json-diff-rfc6902 down to the same pure-content hashing for a fair comparison.
// `hashObject.hash` is looked up dynamically on every diff() call (not captured at require
// time), so overwriting the export here is picked up transparently.
hashObject.hash = (obj: unknown) => hashToNum(JSON.stringify(obj));

const ITERATIONS = 10;
export const SOURCES = ["Xignite", "Stackoverflow", "Twitter"] as const;

export const ALGORITHMS = {
    "tiny-patch": (a, b) => tinypatch.diff(a, b),
    "tiny-patch (minified)": (a, b) => tinypatch.diff(a, b, { transform: "minify" }),
    JDR: (a, b) => jdr.diff(a, b),
    jiff: (a, b) => jiff.diff(a, b, { invertible: false }),
    "Fast-JSON-Patch": (a, b) => jsonpatch.compare(a, b) as any[],
    rfc6902: (a, b) => rfc6902.createPatch(a, b),
    "JSON8 patch": (a, b) => json8.diff(a, b),
} as const satisfies Record<string, (a: any, b: any) => Patch>;

export async function run(source: (typeof SOURCES)[number]) {
    console.log(`Processing case ${source}`);
    const dataDir = path.join(__dirname, source);

    const versions = (await fs.readdir(dataDir))
        .map((f) => Number(f.replace(/^new_(\d+).json$/, "$1")))
        .filter((v) => !Number.isNaN(v))
        .sort((a, b) => a - b);

    const results: Record<keyof typeof ALGORITHMS, { byteLength: number; duration: number }[]> = Object.fromEntries(
        Object.keys(ALGORITHMS).map((a) => [a, []]),
    ) as never;

    for (let i = 0; i < versions.length - 1; i++) {
        const version = versions[i] as number;
        const [f_old, f_new] = await Promise.all([
            Bun.file(path.join(dataDir, `new_${version}.json`)).json(),
            Bun.file(path.join(dataDir, `new_${versions[i + 1]}.json`)).json(),
        ]);

        for (const [algorithm, fn] of Object.entries(ALGORITHMS)) {
            const start = Bun.nanoseconds();
            for (let i = 0; i < ITERATIONS; i++) fn(f_old, f_new);
            const end = Bun.nanoseconds();
            const duration = (end - start) / ITERATIONS;

            const byteLength = Buffer.byteLength(JSON.stringify(fn(f_old, f_new)), "utf8");

            results[algorithm as keyof typeof ALGORITHMS].push({ byteLength, duration });
        }
    }

    console.log("Done");

    return results;
}

import { bench, describe } from "vitest";
import { deepClone } from "./deepClone";
import { deepEquals } from "./deepEquals";
import type { Json, JsonArray, JsonObject } from "./types";

/**
 * Compares deepClone against the two common built-in alternatives:
 * - JSON.parse(JSON.stringify(x)) - the classic "free" deep clone
 * - structuredClone(x) - the native, spec'd deep clone (also handles non-JSON
 *   types, which is irrelevant here since every fixture is plain Json)
 *
 * Run via `npm run bench` (or `vitest bench --run src/deepClone.bench.ts`).
 */

const providers = {
    deepClone: (val: Json) => deepClone(val),
    "JSON.parse(JSON.stringify)": (val: Json) => JSON.parse(JSON.stringify(val)),
    structuredClone: (val: Json) => structuredClone(val),
} satisfies Record<string, (val: Json) => Json>;

function buildPrimitiveArray(size: number): Json {
    const out: JsonArray = [];
    for (let i = 0; i < size; i++) out.push(i % 3 === 0 ? `item-${i}` : i);
    return out;
}

function buildFlatObject(size: number): Json {
    const out: JsonObject = {};
    for (let i = 0; i < size; i++) out[`key_${i}`] = i % 2 === 0 ? i : `value-${i}`;
    return out;
}

function buildApiPayload(count: number): Json {
    const out: JsonArray = [];
    for (let i = 0; i < count; i++) {
        out.push({
            id: i,
            name: `item-${i}`,
            active: i % 2 === 0,
            tags: [`tag-${i % 5}`, `tag-${i % 7}`],
            meta: { createdAt: i, owner: { id: i % 100, name: `owner-${i % 100}` } },
        });
    }
    return out;
}

function buildDeepChain(depth: number): Json {
    let src: Json = { first: 1, second: 2, third: 3 };
    for (let i = 0; i < depth; i++) src = { [`k${i}`]: src, tail: i };
    return src;
}

const fixtures = {
    "primitive array (10k)": buildPrimitiveArray(10_000),
    "flat object (2k keys)": buildFlatObject(2_000),
    "api payload (5k records)": buildApiPayload(5_000),
    "deep chain (depth 1k)": buildDeepChain(1_000),
} satisfies Record<string, Json>;

// Sanity check correctness before benchmarking - all providers must agree.
for (const [fixtureName, fixture] of Object.entries(fixtures)) {
    for (const [providerName, provider] of Object.entries(providers)) {
        const actual = provider(deepClone(fixture));
        if (!deepEquals(actual, fixture)) {
            throw new Error(`${providerName} disagrees with deepClone on fixture "${fixtureName}"`);
        }
    }
}

Object.entries(fixtures).forEach(([fixtureName, fixture]) => {
    describe(fixtureName, () => {
        Object.entries(providers).forEach(([providerName, provider]) => {
            bench(providerName, () => {
                provider(fixture);
            });
        });
    });
});

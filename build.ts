import { build } from "tsdown";

await build({
    entry: ["./index.ts"],
    outDir: "./dist",
    platform: "neutral",
    target: "es6",
    fixedExtension: true,
    format: {
        esm: {},
        cjs: {
            outputOptions: {
                exports: "named",
            },
            plugins: [
                {
                    name: "cjs-interop",
                    renderChunk(code) {
                        // Only target the CommonJS output bundle
                        const fallback = `
// Compatibility fallback for direct CJS require()
if (module.exports && module.exports.default) {
  Object.assign(module.exports, module.exports.default);
}
`;
                        return { code: code + fallback };
                    },
                },
            ],
        },
        umd: {
            outputOptions: {
                name: "tinypatch",
                exports: "named",
            },
        },
    },
    dts: true,
    clean: true,
    minify: true,
});

import { build } from "tsdown";

await build({
    entry: ["./src/index.ts"],
    outDir: "./dist",
    platform: "neutral",
    target: "es6",
    fixedExtension: true,
    format: {
        es: {},
        cjs: {
            outputOptions: {
                exports: "named",
            },
        },
        umd: {
            minify: true,
            outputOptions: {
                name: "tinypatch",
                exports: "named",
            },
        },
    },
    dts: true,
    clean: true,
    plugins: [
        {
            name: "cjs-interop",
            renderChunk(code, chunk) {
                // Only target the CommonJS output bundle
                if (chunk.fileName.endsWith(".cjs")) {
                    const fallback = `
// Compatibility fallback for direct CJS require()
if (module.exports && module.exports.default) {
  Object.assign(module.exports, module.exports.default);
}
`;
                    return { code: code + fallback };
                }
                return null;
            },
        },
    ],
});

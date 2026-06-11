import { defineConfig } from "tsup";

export default defineConfig({
  entry: ["src/index.ts"],
  outDir: "dist",
  format: ["esm", "cjs"],
  dts: true,
  sourcemap: true,
  clean: true,
  minify: false,
  splitting: false,
  treeshake: true,
  outExtension: ({ format }) => ({ js: format === "cjs" ? ".cjs" : ".js" }),
  // Bundle workspace `@jdf/core` types/source so consumers don't need it
  noExternal: ["@jdf/core"],
  // Inject the CSS as a separate file alongside the JS
  injectStyle: false,
  loader: { ".css": "copy" },
  globalName: "JDFjs",
  outExtension: ({ format }) => {
    if (format === "cjs") return { js: ".cjs" };
    return { js: ".js" };
  },
});

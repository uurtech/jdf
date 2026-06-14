import { defineConfig } from "tsup";
import { copyFileSync, mkdirSync } from "node:fs";
import { resolve } from "node:path";

export default defineConfig({
  entry: { jdfjs: "src/index.ts" },
  outDir: "dist",
  format: ["esm", "cjs"],
  dts: true,
  sourcemap: true,
  clean: true,
  minify: true,
  splitting: false,
  treeshake: true,
  noExternal: ["@jdf/core", "jszip"],
  globalName: "JDFjs",
  outExtension: ({ format }) => (format === "cjs" ? { js: ".cjs" } : { js: ".js" }),
  onSuccess: async () => {
    mkdirSync(resolve("dist"), { recursive: true });
    copyFileSync(resolve("src/jdfjs.css"), resolve("dist/jdfjs.css"));
  },
});

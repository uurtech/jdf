import { defineConfig } from "tsup";
import { copyFileSync, mkdirSync } from "node:fs";
import { resolve } from "node:path";

export default defineConfig({
  entry: { index: "src/index.ts" },
  outDir: "dist",
  format: ["esm"],
  target: "node18",
  platform: "node",
  sourcemap: false,
  clean: true,
  splitting: false,
  treeshake: true,
  // Bundle workspace deps — they aren't published to npm separately.
  noExternal: ["@jdf/core"],
  // Keep the shebang so `npx @uurtech/cli` and a globally-installed `jdf`
  // both invoke node correctly.
  banner: { js: "#!/usr/bin/env node" },
  onSuccess: async () => {
    // Copy the JSON Schema next to the bundle so the validator finds it
    // at runtime via a relative path.
    mkdirSync(resolve("dist"), { recursive: true });
    copyFileSync(
      resolve("../../spec/jdf-schema.json"),
      resolve("dist/jdf-schema.json")
    );
  },
});

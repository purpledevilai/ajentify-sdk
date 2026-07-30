import { defineConfig } from "tsup";

export default defineConfig({
  entry: { index: "src/index.ts" },
  format: ["esm", "cjs"],
  dts: true,
  sourcemap: true,
  clean: true,
  treeshake: true,
  target: "node18",
  // zod / zod-to-json-schema are optional peer deps; never bundle them.
  external: ["zod", "zod-to-json-schema"],
});

import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: {
    // See test/node-sqlite.shim.ts: the builtin by another route, for the test runner only.
    alias: { "node:sqlite": fileURLToPath(new URL("./test/node-sqlite.shim.ts", import.meta.url)) },
  },
});

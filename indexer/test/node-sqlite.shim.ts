// Vitest's Vite doesn't yet list `sqlite` among Node's builtins (it reads `builtinModules`, which
// omits experimental ones on Node 22), so it tries to resolve "sqlite" as a package. Under the
// runner, `node:sqlite` is aliased to this file, which loads the real builtin through require.
import { createRequire } from "node:module";

const sqlite = createRequire(import.meta.url)("node:sqlite") as typeof import("node:sqlite");
export const DatabaseSync = sqlite.DatabaseSync;

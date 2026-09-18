import { fileURLToPath } from "node:url";
import { join } from "node:path";
import { defineConfig } from "vitest/config";

const root = fileURLToPath(new URL(".", import.meta.url));
const cortexAlias = Object.fromEntries(
  ["shared", "client", "database", "embeddings", "core", "agents"].map((p) => [`@cortex/${p}`, join(root, "packages", p, "src/index.ts")]),
);

/**
 * Workspace-level Vitest. The tests live in `tests/` and import either the public APIs
 * (@cortex/*) or individual modules. The plugin resolves NodeNext imports with a `.js`
 * extension to their `.ts` sources (the repo runs ESM NodeNext + tsx, there is no build).
 */
export default defineConfig({
  plugins: [
    {
      name: "nodenext-js-to-ts",
      enforce: "pre",
      async resolveId(source, importer, options) {
        if (importer && source.endsWith(".js") && (source.startsWith("./") || source.startsWith("../"))) {
          const r = await this.resolve(source.slice(0, -3) + ".ts", importer, { ...options, skipSelf: true });
          if (r) return r;
        }
        return null;
      },
    },
  ],
  resolve: { alias: cortexAlias },
  test: {
    include: ["tests/*.test.ts"], // unit (the root of tests/); integration has a config of its own
    environment: "node",
  },
});

import { fileURLToPath } from "node:url";
import { join } from "node:path";
import { defineConfig } from "vitest/config";

const root = fileURLToPath(new URL(".", import.meta.url));
const cortexAlias = Object.fromEntries(
  ["shared", "client", "database", "embeddings", "core", "agents"].map((p) => [`@cortex/${p}`, join(root, "packages", p, "src/index.ts")]),
);

/**
 * Vitest a nivel de workspace. Los tests viven en `tests/` e importan las APIs públicas
 * (@cortex/*) o módulos sueltos. El plugin resuelve los imports NodeNext con extensión
 * `.js` a sus fuentes `.ts` (el repo usa ESM NodeNext + tsx, no hay build).
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
    include: ["tests/*.test.ts"], // unit (raíz de tests/); la integración va en su propio config
    environment: "node",
  },
});

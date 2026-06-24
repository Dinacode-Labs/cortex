import { defineConfig } from "vitest/config";

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
  test: {
    include: ["tests/**/*.test.ts"],
    environment: "node",
  },
});

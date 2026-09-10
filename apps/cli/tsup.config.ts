import { defineConfig } from "tsup";
import { createRequire } from "node:module";

const pkg = createRequire(import.meta.url)("./package.json") as { version: string };

/**
 * El CLI se publica en npm como **un solo fichero**: `@cortex/client` y `@cortex/shared` se
 * meten dentro (`noExternal`) porque son paquetes privados del monorepo y npm no sabría
 * descargarlos.
 *
 * Lo que SÍ queda fuera es el SDK de MCP, zod y yaml: el SDK hace `require` dinámicos que un
 * bundle plano rompe, y los tres son paquetes públicos que npm instala sin problema.
 *
 * La versión se inyecta en tiempo de build en vez de leer el package.json en ejecución:
 * después del bundle no hay package.json al lado del fichero.
 */
export default defineConfig({
  entry: { cortex: "src/index.ts" },
  format: ["esm"],
  platform: "node",
  target: "node20",
  splitting: false,
  clean: true,
  dts: false,
  sourcemap: false,
  noExternal: [/^@cortex\//],
  external: ["@modelcontextprotocol/sdk", "zod", "yaml"],
  define: { __CORTEX_VERSION__: JSON.stringify(pkg.version) },
  banner: { js: "#!/usr/bin/env node" },
});

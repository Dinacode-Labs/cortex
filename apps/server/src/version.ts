import { createRequire } from "node:module";

/**
 * Versión del servidor y versión mínima de cliente que admite.
 *
 * Se lee del `package.json` de la raíz en tiempo de ejecución en vez de incrustarla en el
 * build: así una imagen no puede acabar anunciando una versión que no es la suya. La
 * profundidad es la misma desde `src/` y desde `dist/` (ambos cuelgan de `apps/server/`).
 */
const require = createRequire(import.meta.url);

function readVersion(): string {
  try {
    return (require("../../../package.json") as { version?: string }).version ?? "dev";
  } catch {
    return "dev";
  }
}

export const SERVER_VERSION = readVersion();

/**
 * Por debajo de esta versión, el CLI avisa de que hay que actualizar. Se sube cuando un
 * cambio del servidor rompe a los clientes viejos, no en cada release.
 */
export const MIN_CLIENT_VERSION = process.env.CORTEX_MIN_CLIENT_VERSION?.trim() || "0.1.0";

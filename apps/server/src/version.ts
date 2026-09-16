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
 * El CLI más viejo que ESTE servidor admite (ADR-0060). Es el único número que puede bloquear:
 * por debajo, el CLI se niega a escribir (leer sigue funcionando). Lo sube el operador cuando
 * un cambio del servidor rompe de verdad a los clientes viejos, no en cada release; por eso el
 * default es tan bajo. `SERVER_VERSION`, en cambio, es solo informativa: el CLI la usa para
 * avisar de que hay versión nueva, o de que el servidor se ha quedado atrás.
 */
export const MIN_CLIENT_VERSION = process.env.CORTEX_MIN_CLIENT_VERSION?.trim() || "0.1.0";

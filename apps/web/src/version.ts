import { createRequire } from "node:module";

/**
 * Sufijo de las URL de los estáticos.
 *
 * `/styles.css` se sirve sin `Cache-Control` ni `ETag` —solo `Last-Modified`—, así que el
 * navegador aplica su heurística y se queda la copia vieja sin preguntar. El resultado es que
 * quien ya había entrado ve la interfaz nueva con los estilos antiguos, a medio pintar, y
 * desde fuera parece que el despliegue no ha llegado. Pegar la versión a la URL convierte
 * cada release en un fichero distinto, que es la forma barata y sin dependencias de hacerlo.
 */
function versionDelPaquete(): string {
  try {
    const require = createRequire(import.meta.url);
    // Misma profundidad desde `src/` y desde `dist/`.
    return (require("../package.json") as { version?: string }).version ?? "dev";
  } catch {
    return "dev";
  }
}

export const ASSET_VERSION = versionDelPaquete();

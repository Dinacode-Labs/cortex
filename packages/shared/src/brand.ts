import { existsSync, readFileSync } from "node:fs";
import { getEnv } from "./env.js";

/**
 * Marca visible del producto. Existe para que quien despliegue Cortex no herede la marca
 * de quien lo escribió: el nombre y el logo son configuración del operador, no constantes
 * del código (ADR-0013 revisado).
 *
 * Se usa en el <title> y la cabecera de la web, la pantalla de login, el asunto del email
 * de OTP, el contexto que se inyecta a los agentes y la ayuda del CLI.
 */

/** Nombre de marca visible. Default: "Cortex". */
export function getBrandName(): string {
  return getEnv("CORTEX_BRAND_NAME", "").trim() || "Cortex";
}

let logoCache: string | null | undefined;

/**
 * SVG del logo, o null si no hay (la web cae entonces a un wordmark de texto).
 * Fuentes: `CORTEX_BRAND_LOGO_SVG` (inline) o `CORTEX_BRAND_LOGO_FILE` (ruta).
 *
 * Nota de seguridad: la web inserta esto con `raw()`, así que se valida que parezca un
 * SVG y no traiga `<script>`. Es configuración del OPERADOR (confiable por definición:
 * quien puede escribir la env ya controla el proceso), no entrada de usuario; la
 * comprobación es una red contra el error tonto, no un sanitizador.
 */
export function getBrandLogoSvg(): string | null {
  if (logoCache !== undefined) return logoCache;
  const inline = getEnv("CORTEX_BRAND_LOGO_SVG", "").trim();
  const file = getEnv("CORTEX_BRAND_LOGO_FILE", "").trim();
  let svg = inline;
  if (!svg && file) {
    try {
      svg = existsSync(file) ? readFileSync(file, "utf8").trim() : "";
    } catch {
      svg = ""; // ruta ilegible: se degrada al wordmark, no se rompe la página
    }
  }
  logoCache = svg && /^<svg[\s>]/i.test(svg) && !/<script/i.test(svg) ? svg : null;
  return logoCache;
}

/** Descarta el logo cacheado. Solo para tests. */
export function resetBrandCache(): void {
  logoCache = undefined;
}

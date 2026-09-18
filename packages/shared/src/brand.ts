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

/**
 * El sello por defecto: «Relay». Dos piezas en L —la sesión que termina y la que empieza— y un
 * cuadrado en el centro —lo aprendido— que no se mueve mientras las piezas se sustituyen.
 *
 * Está dibujado en una rejilla de 8×8 a propósito: así es el MISMO dibujo en la cabecera de la
 * web (28 px), en el favicon (16 px = 2 px por celda, sin reescalar) y en el terminal, donde el
 * CLI lo pinta con caracteres de bloque. Un solo color para las piezas y el acento para el
 * centro; sin degradados ni texto, para que aguante en monocromo. Criterio visual, no
 * arquitectura: no lleva ADR.
 */
export const MARK_GRID: readonly string[] = [
  "XXXXX...",
  "XXXXX...",
  "XX......",
  "XX.XX.XX",
  "XX.XX.XX",
  "......XX",
  "...XXXXX",
  "...XXXXX",
];

/** `a` y `b` son las dos piezas (sesiones); `core` es el cuadrado central (lo aprendido). */
export type MarkPart = "a" | "b" | "core";
export interface MarkCell {
  x: number;
  y: number;
  part: MarkPart;
}

/** Las 36 celdas del sello, en orden de lectura, cada una con la parte a la que pertenece. */
export function markCells(): MarkCell[] {
  const cells: MarkCell[] = [];
  MARK_GRID.forEach((row, y) => {
    [...row].forEach((ch, x) => {
      if (ch !== "X") return;
      const core = x >= 3 && x <= 4 && y >= 3 && y <= 4;
      cells.push({ x, y, part: core ? "core" : x <= 4 && y <= 4 ? "a" : "b" });
    });
  });
  return cells;
}

export interface MarkSvgOptions {
  /** Color de las piezas: el relleno si van sólidas, el trazo si van huecas. Vale `var(--ink)`. */
  ink: string;
  /** Color del centro. */
  accent: string;
  /**
   * Piezas huecas: relleno de este color y un contorno de `ink` de `strokeWidth` unidades
   * (la rejilla mide 8). El contorno va por DENTRO del borde, así el dibujo no crece y a 16 px
   * (2 px por celda) un `strokeWidth` de 0.5 es exactamente 1 px, sin difuminar.
   */
  hollow?: { fill: string; strokeWidth: number };
  /** Clases del `<svg>` (la web engancha ahí la animación). */
  className?: string;
  /** CSS embebido en el SVG: lo usa el favicon para cambiar de color en tema oscuro. */
  style?: string;
}

/** Contorno de cada pieza en L, como polígono, encogido `d` unidades hacia dentro. */
function piecePath(part: "a" | "b", d: number): string {
  const pts: [number, number][] =
    part === "a"
      ? [[d, d], [5 - d, d], [5 - d, 2 - d], [2 - d, 2 - d], [2 - d, 5 - d], [d, 5 - d]]
      : [[8 - d, 8 - d], [3 + d, 8 - d], [3 + d, 6 + d], [6 + d, 6 + d], [6 + d, 3 + d], [8 - d, 3 + d]];
  return "M" + pts.map(([x, y]) => `${x} ${y}`).join("L") + "Z";
}

/**
 * El sello como SVG. Las dos piezas son un `<path>` cada una y el centro un `<rect>`, todos
 * con `data-g` para que el CSS pueda mover cada parte por separado. `shape-rendering:
 * crispEdges` mantiene los píxeles limpios a 16 px.
 */
export function markSvg(opts: MarkSvgOptions): string {
  const cls = opts.className ? ` class="${opts.className}"` : "";
  const style = opts.style ? `<style>${opts.style}</style>` : "";
  const h = opts.hollow;
  const piece = (part: "a" | "b"): string =>
    h
      ? `<path data-g="${part}" d="${piecePath(part, h.strokeWidth / 2)}" fill="${h.fill}" stroke="${opts.ink}" stroke-width="${h.strokeWidth}" stroke-linejoin="miter"/>`
      : `<path data-g="${part}" d="${piecePath(part, 0)}" fill="${opts.ink}"/>`;
  const core = `<rect data-g="core" x="3" y="3" width="2" height="2" fill="${opts.accent}"/>`;
  return `<svg${cls} viewBox="0 0 8 8" shape-rendering="crispEdges" aria-hidden="true">${style}${piece("a")}${core}${piece("b")}</svg>`;
}

/** true si el operador no ha puesto ni nombre ni logo propios: entonces el sello es el de Cortex. */
export function isDefaultBrand(): boolean {
  return !getEnv("CORTEX_BRAND_NAME", "").trim() && getBrandLogoSvg() === null;
}

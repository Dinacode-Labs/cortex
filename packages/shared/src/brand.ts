import { existsSync, readFileSync } from "node:fs";
import { getEnv } from "./env.js";

/**
 * The product's visible branding. It exists so that whoever deploys Cortex does not inherit
 * the branding of whoever wrote it: name and logo are operator configuration, not code
 * constants (ADR-0013, revised).
 *
 * Used in the web <title> and header, the login screen, the subject of the OTP email, the
 * context injected into agents and the CLI help.
 */

/** Visible brand name. Defaults to "Cortex". */
export function getBrandName(): string {
  return getEnv("CORTEX_BRAND_NAME", "").trim() || "Cortex";
}

let logoCache: string | null | undefined;

/**
 * The logo SVG, or null if there is none (the web then falls back to a text wordmark).
 * Sources: `CORTEX_BRAND_LOGO_SVG` (inline) or `CORTEX_BRAND_LOGO_FILE` (a path).
 *
 * Security note: the web inserts this with `raw()`, so it is checked to look like an SVG
 * and to carry no `<script>`. This is OPERATOR configuration (trusted by definition:
 * whoever can set the env var already controls the process), not user input; the check is
 * a net against a silly mistake, not a sanitiser.
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
      svg = ""; // unreadable path: degrade to the wordmark rather than break the page
    }
  }
  logoCache = svg && /^<svg[\s>]/i.test(svg) && !/<script/i.test(svg) ? svg : null;
  return logoCache;
}

/** Drops the cached logo. Tests only. */
export function resetBrandCache(): void {
  logoCache = undefined;
}

/**
 * The default mark, "Relay": two L-shaped pieces — the session that ends and the one that starts —
 * and a square in the centre — what was learned — that stays put while the pieces are replaced.
 *
 * It is drawn on an 8×8 grid on purpose: that way it is the SAME drawing in the web header
 * (28 px), in the favicon (16 px = 2 px per cell, no rescaling) and in the terminal, where the CLI
 * paints it with block characters. One colour for the pieces and the accent for the centre; no
 * gradients and no text, so it survives in monochrome. Visual judgement, not architecture: no ADR.
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

/** `a` and `b` are the two pieces (sessions); `core` is the central square (what was learned). */
export type MarkPart = "a" | "b" | "core";
export interface MarkCell {
  x: number;
  y: number;
  part: MarkPart;
}

/** The mark's 36 cells in reading order, each with the part it belongs to. */
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
  /** Colour of the pieces: the fill when solid, the stroke when hollow. `var(--ink)` works. */
  ink: string;
  /** Colour of the centre. */
  accent: string;
  /**
   * Hollow pieces: filled with this colour and outlined in `ink`, `strokeWidth` units wide (the
   * grid is 8). The outline runs INSIDE the edge, so the drawing does not grow and at 16 px (2 px
   * per cell) a `strokeWidth` of 0.5 is exactly 1 px, with no blur.
   */
  hollow?: { fill: string; strokeWidth: number };
  /** Classes on the `<svg>` (the web hooks the animation there). */
  className?: string;
  /** CSS embedded in the SVG: the favicon uses it to change colour in dark mode. */
  style?: string;
}

/** Outline of each L-shaped piece as a polygon, shrunk `d` units inwards. */
function piecePath(part: "a" | "b", d: number): string {
  const pts: [number, number][] =
    part === "a"
      ? [[d, d], [5 - d, d], [5 - d, 2 - d], [2 - d, 2 - d], [2 - d, 5 - d], [d, 5 - d]]
      : [[8 - d, 8 - d], [3 + d, 8 - d], [3 + d, 6 + d], [6 + d, 6 + d], [6 + d, 3 + d], [8 - d, 3 + d]];
  return "M" + pts.map(([x, y]) => `${x} ${y}`).join("L") + "Z";
}

/**
 * The mark as SVG. The two pieces are one `<path>` each and the centre a `<rect>`, all carrying
 * `data-g` so the CSS can move each part on its own. `shape-rendering: crispEdges` keeps the
 * pixels clean at 16 px.
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

/** true when the operator has set neither a name nor a logo: the mark is then Cortex's own. */
export function isDefaultBrand(): boolean {
  return !getEnv("CORTEX_BRAND_NAME", "").trim() && getBrandLogoSvg() === null;
}

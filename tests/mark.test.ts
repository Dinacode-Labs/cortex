import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { isDefaultBrand, MARK_GRID, markCells, markSvg, resetBrandCache } from "@cortex/shared";
import { paint, renderMark, splashLines, wantsSplash } from "../apps/cli/src/splash.js";

/**
 * El sello de Cortex es un dibujo de 8×8 que comparten la web, el favicon y el splash del CLI.
 * Aquí se fija lo que no puede cambiar sin querer: la rejilla, las tres partes, que el SVG sea
 * inyectable con `raw()` (sin script), y que el splash NO salga donde no debe: sin TTY, en CI,
 * o cuando el operador ha puesto su propia marca.
 */
beforeEach(() => {
  vi.stubEnv("CORTEX_BRAND_NAME", "");
  vi.stubEnv("CORTEX_BRAND_LOGO_SVG", "");
  vi.stubEnv("CORTEX_BRAND_LOGO_FILE", "");
  resetBrandCache();
});
afterEach(() => {
  vi.unstubAllEnvs();
  resetBrandCache();
});

describe("el sello", () => {
  it("es una rejilla de 8×8 con dos piezas de 16 celdas y un centro de 4", () => {
    expect(MARK_GRID).toHaveLength(8);
    for (const row of MARK_GRID) expect(row).toHaveLength(8);
    const cells = markCells();
    expect(cells).toHaveLength(36);
    expect(cells.filter((c) => c.part === "core")).toHaveLength(4);
    expect(cells.filter((c) => c.part === "a")).toHaveLength(16);
    expect(cells.filter((c) => c.part === "b")).toHaveLength(16);
  });

  it("como SVG lleva una parte por elemento y nada que raw() no pueda insertar", () => {
    const svg = markSvg({ ink: "var(--ink)", accent: "var(--accent)", className: "mark" });
    expect(svg.startsWith('<svg class="mark" viewBox="0 0 8 8"')).toBe(true);
    expect(svg).not.toContain("<script");
    expect(svg.match(/data-g="a"/g)).toHaveLength(1);
    expect(svg.match(/data-g="b"/g)).toHaveLength(1);
    expect(svg).toContain('data-g="core"');
  });

  it("hueco: relleno propio y el contorno por dentro, para que a 16 px sea 1 px exacto", () => {
    const svg = markSvg({ ink: "#000", accent: "#00f", hollow: { fill: "#fff", strokeWidth: 0.5 } });
    expect(svg).toContain('stroke="#000" stroke-width="0.5"');
    expect(svg).toContain('d="M0.25 0.25L4.75 0.25'); // encogido strokeWidth/2
  });

  it("es el sello por defecto solo si el operador no ha puesto nombre ni logo", () => {
    expect(isDefaultBrand()).toBe(true);
    vi.stubEnv("CORTEX_BRAND_NAME", "Acme Memory");
    expect(isDefaultBrand()).toBe(false);
  });
});

describe("splash del CLI", () => {
  const env = { COLORTERM: "truecolor" } as NodeJS.ProcessEnv;

  it("solo sale en un terminal interactivo, fuera de CI, con la marca por defecto", () => {
    expect(wantsSplash({ env, tty: true })).toBe(true);
    expect(wantsSplash({ env, tty: false })).toBe(false);
    expect(wantsSplash({ env: { ...env, CI: "1" }, tty: true })).toBe(false);
    expect(wantsSplash({ env: { ...env, TERM: "dumb" }, tty: true })).toBe(false);
    vi.stubEnv("CORTEX_BRAND_NAME", "Acme Memory");
    expect(wantsSplash({ env, tty: true })).toBe(false);
  });

  it("pinta el sello en 8 líneas de 16 columnas, con el centro en el acento", () => {
    const lines = renderMark(paint({ NO_COLOR: "" }));
    expect(lines).toHaveLength(8);
    for (const l of lines) expect(l).toHaveLength(16);
    expect(lines[3]).toBe("▀ ▀   ▀ ▀   ▀ ▀ ");
    const color = renderMark(paint(env));
    expect(color[3]).toContain("\x1b[38;2;26;109;255m▀");
    expect(color[0]).not.toContain("\x1b[");
    // con color, el ancho visible sigue siendo 16: si no, la columna de texto baila
    for (const l of color) expect(l.replace(/\x1b\[[0-9;]*m/g, "")).toHaveLength(16);
  });

  it("con NO_COLOR no emite ningún escape", () => {
    const out = splashLines("1.2.3", { NO_COLOR: "" }).join("\n");
    expect(out).not.toContain("\x1b[");
    expect(out).toContain("v1.2.3");
    expect(out).toContain("Cortex");
  });
});

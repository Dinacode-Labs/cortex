import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { isDefaultBrand, MARK_GRID, markCells, markSvg, resetBrandCache } from "@cortex/shared";
import { paint, renderMark, splashLines, wantsSplash } from "../apps/cli/src/splash.js";

/**
 * The Cortex mark is one 8×8 drawing shared by the web, the favicon and the CLI splash. What is
 * pinned here is what must not change by accident: the grid, the three parts, the SVG being safe
 * for `raw()` (no script), and the splash NOT appearing where it must not: without a TTY, in CI,
 * or when the operator has set their own brand.
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

describe("the mark", () => {
  it("is an 8×8 grid with two 16-cell pieces and a 4-cell centre", () => {
    expect(MARK_GRID).toHaveLength(8);
    for (const row of MARK_GRID) expect(row).toHaveLength(8);
    const cells = markCells();
    expect(cells).toHaveLength(36);
    expect(cells.filter((c) => c.part === "core")).toHaveLength(4);
    expect(cells.filter((c) => c.part === "a")).toHaveLength(16);
    expect(cells.filter((c) => c.part === "b")).toHaveLength(16);
  });

  it("as SVG carries one element per part and nothing raw() cannot insert", () => {
    const svg = markSvg({ ink: "var(--ink)", accent: "var(--accent)", className: "mark" });
    expect(svg.startsWith('<svg class="mark" viewBox="0 0 8 8"')).toBe(true);
    expect(svg).not.toContain("<script");
    expect(svg.match(/data-g="a"/g)).toHaveLength(1);
    expect(svg.match(/data-g="b"/g)).toHaveLength(1);
    expect(svg).toContain('data-g="core"');
  });

  it("hollow: its own fill and the outline inside, so at 16 px it is exactly 1 px", () => {
    const svg = markSvg({ ink: "#000", accent: "#00f", hollow: { fill: "#fff", strokeWidth: 0.5 } });
    expect(svg).toContain('stroke="#000" stroke-width="0.5"');
    expect(svg).toContain('d="M0.25 0.25L4.75 0.25'); // shrunk by strokeWidth/2
  });

  it("is the default mark only when the operator has set neither name nor logo", () => {
    expect(isDefaultBrand()).toBe(true);
    vi.stubEnv("CORTEX_BRAND_NAME", "Acme Memory");
    expect(isDefaultBrand()).toBe(false);
  });
});

describe("CLI splash", () => {
  const env = { COLORTERM: "truecolor" } as NodeJS.ProcessEnv;

  it("only shows on an interactive terminal, outside CI, with the default brand", () => {
    expect(wantsSplash({ env, tty: true })).toBe(true);
    expect(wantsSplash({ env, tty: false })).toBe(false);
    expect(wantsSplash({ env: { ...env, CI: "1" }, tty: true })).toBe(false);
    expect(wantsSplash({ env: { ...env, TERM: "dumb" }, tty: true })).toBe(false);
    vi.stubEnv("CORTEX_BRAND_NAME", "Acme Memory");
    expect(wantsSplash({ env, tty: true })).toBe(false);
  });

  it("paints the mark as 8 lines of 16 columns, with the centre in the accent", () => {
    const lines = renderMark(paint({ NO_COLOR: "" }));
    expect(lines).toHaveLength(8);
    for (const l of lines) expect(l).toHaveLength(16);
    expect(lines[3]).toBe("▀ ▀   ▀ ▀   ▀ ▀ ");
    const color = renderMark(paint(env));
    expect(color[3]).toContain("\x1b[38;2;26;109;255m▀");
    expect(color[0]).not.toContain("\x1b[");
    // with colour the visible width is still 16: otherwise the text column wobbles
    for (const l of color) expect(l.replace(/\x1b\[[0-9;]*m/g, "")).toHaveLength(16);
  });

  it("emits no escape at all under NO_COLOR", () => {
    const out = splashLines("1.2.3", { NO_COLOR: "" }).join("\n");
    expect(out).not.toContain("\x1b[");
    expect(out).toContain("v1.2.3");
    expect(out).toContain("Cortex");
  });
});

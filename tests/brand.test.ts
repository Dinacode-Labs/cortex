import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { getBrandLogoSvg, getBrandName, resetBrandCache } from "@cortex/shared";

/**
 * Branding is operator configuration, not a code constant (ADR-0013, revised): whoever
 * deploys Cortex should not inherit the branding of whoever wrote it. The logo is inserted
 * with `raw()` in the web, so what gets rejected is pinned down here too.
 */
let dir: string;

beforeEach(() => {
  vi.stubEnv("CORTEX_BRAND_NAME", "");
  vi.stubEnv("CORTEX_BRAND_LOGO_SVG", "");
  vi.stubEnv("CORTEX_BRAND_LOGO_FILE", "");
  resetBrandCache();
  dir = mkdtempSync(join(tmpdir(), "cortex-brand-"));
});
afterEach(() => {
  vi.unstubAllEnvs();
  resetBrandCache();
  rmSync(dir, { recursive: true, force: true });
});

describe("getBrandName", () => {
  it("defaults to Cortex", () => {
    expect(getBrandName()).toBe("Cortex");
  });

  it("lo sobreescribe CORTEX_BRAND_NAME", () => {
    vi.stubEnv("CORTEX_BRAND_NAME", "Acme Memory");
    expect(getBrandName()).toBe("Acme Memory");
  });
});

describe("getBrandLogoSvg", () => {
  it("with nothing configured there is no logo (the web falls back to the text wordmark)", () => {
    expect(getBrandLogoSvg()).toBeNull();
  });

  it("acepta un SVG inline", () => {
    vi.stubEnv("CORTEX_BRAND_LOGO_SVG", '<svg viewBox="0 0 10 10"><path d="M0 0"/></svg>');
    expect(getBrandLogoSvg()).toContain("<svg");
  });

  it("reads the SVG from a file", () => {
    const file = join(dir, "logo.svg");
    writeFileSync(file, '<svg width="10"><rect/></svg>');
    vi.stubEnv("CORTEX_BRAND_LOGO_FILE", file);
    expect(getBrandLogoSvg()).toContain("<rect/>");
  });

  it("rejects content with <script> (it is inserted with raw in the web)", () => {
    vi.stubEnv("CORTEX_BRAND_LOGO_SVG", '<svg><script>alert(1)</script></svg>');
    expect(getBrandLogoSvg()).toBeNull();
  });

  it("rejects anything that is not an SVG", () => {
    vi.stubEnv("CORTEX_BRAND_LOGO_SVG", "<img src=x onerror=alert(1)>");
    expect(getBrandLogoSvg()).toBeNull();
  });

  it("a missing file does not break anything: it degrades to the wordmark", () => {
    vi.stubEnv("CORTEX_BRAND_LOGO_FILE", join(dir, "does-not-exist.svg"));
    expect(getBrandLogoSvg()).toBeNull();
  });
});

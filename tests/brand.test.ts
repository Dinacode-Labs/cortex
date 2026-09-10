import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { getBrandLogoSvg, getBrandName, resetBrandCache } from "@cortex/shared";

/**
 * La marca es configuración del operador, no una constante del código (ADR-0013 revisado):
 * quien despliegue Cortex no debería heredar la marca de quien lo escribió. El logo se
 * inserta con `raw()` en la web, así que aquí se fija también qué se rechaza.
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
  it("por defecto es Cortex", () => {
    expect(getBrandName()).toBe("Cortex");
  });

  it("lo sobreescribe CORTEX_BRAND_NAME", () => {
    vi.stubEnv("CORTEX_BRAND_NAME", "Acme Memory");
    expect(getBrandName()).toBe("Acme Memory");
  });
});

describe("getBrandLogoSvg", () => {
  it("sin configurar no hay logo (la web cae al wordmark de texto)", () => {
    expect(getBrandLogoSvg()).toBeNull();
  });

  it("acepta un SVG inline", () => {
    vi.stubEnv("CORTEX_BRAND_LOGO_SVG", '<svg viewBox="0 0 10 10"><path d="M0 0"/></svg>');
    expect(getBrandLogoSvg()).toContain("<svg");
  });

  it("lee el SVG de un fichero", () => {
    const file = join(dir, "logo.svg");
    writeFileSync(file, '<svg width="10"><rect/></svg>');
    vi.stubEnv("CORTEX_BRAND_LOGO_FILE", file);
    expect(getBrandLogoSvg()).toContain("<rect/>");
  });

  it("rechaza contenido con <script> (se inserta con raw en la web)", () => {
    vi.stubEnv("CORTEX_BRAND_LOGO_SVG", '<svg><script>alert(1)</script></svg>');
    expect(getBrandLogoSvg()).toBeNull();
  });

  it("rechaza lo que no sea un SVG", () => {
    vi.stubEnv("CORTEX_BRAND_LOGO_SVG", "<img src=x onerror=alert(1)>");
    expect(getBrandLogoSvg()).toBeNull();
  });

  it("un fichero inexistente no rompe: degrada a wordmark", () => {
    vi.stubEnv("CORTEX_BRAND_LOGO_FILE", join(dir, "no-existe.svg"));
    expect(getBrandLogoSvg()).toBeNull();
  });
});

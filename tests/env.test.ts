import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

/**
 * `loadEnv` resolvía el `.env` relativo a su propio fichero fuente
 * (`packages/shared/src/../../../.env`). Funcionaba solo mientras el código se ejecutara
 * desde el checkout con tsx: al compilar a `dist/` o al empaquetar el CLI, esa ruta deja de
 * existir. Ahora busca por entorno y cwd. Estos tests fijan ese orden.
 *
 * Se importa con `resetModules` en cada caso porque `loadEnv` cachea (solo carga una vez).
 */
let dir: string;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "cortex-env-"));
  vi.resetModules();
  vi.stubEnv("CORTEX_ENV_FILE", "");
  // Borrar, no vaciar: `process.loadEnvFile` no pisa lo que ya esté DEFINIDO, y una cadena
  // vacía cuenta como definida (el mismo footgun que arreglamos en la config de proveedores).
  delete process.env.CORTEX_TEST_VALUE;
});
afterEach(() => {
  vi.unstubAllEnvs();
  delete process.env.CORTEX_TEST_VALUE;
  rmSync(dir, { recursive: true, force: true });
});

describe("loadEnv", () => {
  it("carga el fichero que indique CORTEX_ENV_FILE", async () => {
    const file = join(dir, "custom.env");
    writeFileSync(file, "CORTEX_TEST_VALUE=desde-env-file\n");
    vi.stubEnv("CORTEX_ENV_FILE", file);

    const { loadEnv } = await import("@cortex/shared");
    loadEnv();
    expect(process.env.CORTEX_TEST_VALUE).toBe("desde-env-file");
  });

  it("no lanza si no hay ningún .env", async () => {
    vi.stubEnv("CORTEX_ENV_FILE", join(dir, "no-existe.env"));
    const { loadEnv } = await import("@cortex/shared");
    expect(() => loadEnv()).not.toThrow();
  });

  it("no pisa una variable que ya venga del entorno real", async () => {
    const file = join(dir, "custom.env");
    writeFileSync(file, "CORTEX_TEST_VALUE=del-fichero\n");
    vi.stubEnv("CORTEX_ENV_FILE", file);
    vi.stubEnv("CORTEX_TEST_VALUE", "del-entorno");

    const { loadEnv } = await import("@cortex/shared");
    loadEnv();
    // `process.loadEnvFile` respeta lo ya definido: el entorno real manda sobre el fichero.
    expect(process.env.CORTEX_TEST_VALUE).toBe("del-entorno");
  });

  it("solo carga una vez, aunque se llame varias veces", async () => {
    const file = join(dir, "custom.env");
    writeFileSync(file, "CORTEX_TEST_VALUE=primera\n");
    vi.stubEnv("CORTEX_ENV_FILE", file);

    const { loadEnv } = await import("@cortex/shared");
    loadEnv();
    writeFileSync(file, "CORTEX_TEST_VALUE=segunda\n");
    loadEnv();
    expect(process.env.CORTEX_TEST_VALUE).toBe("primera");
  });
});

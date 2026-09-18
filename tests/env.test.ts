import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

/**
 * `loadEnv` used to resolve the `.env` relative to its own source file
 * (`packages/shared/src/../../../.env`). That worked only while the code ran from the checkout
 * under tsx: compiled to `dist/` or bundled into the CLI, that path stops existing. It now
 * looks by environment and cwd. These tests pin that order.
 *
 * It is imported with `resetModules` in each case because `loadEnv` caches (it loads once).
 */
let dir: string;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "cortex-env-"));
  vi.resetModules();
  vi.stubEnv("CORTEX_ENV_FILE", "");
  // Delete, do not empty: `process.loadEnvFile` does not overwrite what is already DEFINED,
  // and an empty string counts as defined (the same footgun we fixed in the provider config).
  delete process.env.CORTEX_TEST_VALUE;
});
afterEach(() => {
  vi.unstubAllEnvs();
  delete process.env.CORTEX_TEST_VALUE;
  rmSync(dir, { recursive: true, force: true });
});

describe("loadEnv", () => {
  it("loads the file CORTEX_ENV_FILE points at", async () => {
    const file = join(dir, "custom.env");
    writeFileSync(file, "CORTEX_TEST_VALUE=desde-env-file\n");
    vi.stubEnv("CORTEX_ENV_FILE", file);

    const { loadEnv } = await import("@cortex/shared");
    loadEnv();
    expect(process.env.CORTEX_TEST_VALUE).toBe("desde-env-file");
  });

  it("does not throw when there is no .env at all", async () => {
    vi.stubEnv("CORTEX_ENV_FILE", join(dir, "does-not-exist.env"));
    const { loadEnv } = await import("@cortex/shared");
    expect(() => loadEnv()).not.toThrow();
  });

  it("does not overwrite a variable already coming from the real environment", async () => {
    const file = join(dir, "custom.env");
    writeFileSync(file, "CORTEX_TEST_VALUE=from-the-file\n");
    vi.stubEnv("CORTEX_ENV_FILE", file);
    vi.stubEnv("CORTEX_TEST_VALUE", "del-entorno");

    const { loadEnv } = await import("@cortex/shared");
    loadEnv();
    // `process.loadEnvFile` respects what is already defined: the real environment wins.
    expect(process.env.CORTEX_TEST_VALUE).toBe("del-entorno");
  });

  it("loads only once, however many times it is called", async () => {
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

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { getEmbeddingProvider, resetEmbeddingProvider } from "@cortex/embeddings";

/**
 * La dimensión del embedding fija el esquema vectorial: si se cuela mal, el fallo aparece
 * tarde (al insertar o, peor, al comparar vectores de dimensiones distintas). Por eso el
 * proveedor genérico la exige explícitamente. Aquí se fija ese contrato y el del alias
 * obsoleto `nan` (ADR-0024).
 */
const VARS = [
  "EMBEDDINGS_PROVIDER", "EMBEDDINGS_BASE_URL", "EMBEDDINGS_API_KEY", "EMBEDDINGS_MODEL",
  "EMBEDDINGS_DIM", "EMBEDDINGS_ALLOW_NO_KEY",
  "NAN_API_KEY", "NAN_BASE_URL", "NAN_EMBEDDING_MODEL", "NAN_EMBEDDING_DIM",
];

beforeEach(() => {
  for (const v of VARS) vi.stubEnv(v, "");
  vi.spyOn(console, "warn").mockImplementation(() => {});
  resetEmbeddingProvider();
});
afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
  resetEmbeddingProvider();
});

describe("getEmbeddingProvider", () => {
  it("por defecto usa el proveedor local (arranque sin claves)", () => {
    expect(getEmbeddingProvider().model).toBeTruthy();
  });

  it("openai-compatible exige base URL, modelo y dimensión", () => {
    vi.stubEnv("EMBEDDINGS_PROVIDER", "openai-compatible");
    vi.stubEnv("EMBEDDINGS_API_KEY", "k");
    vi.stubEnv("EMBEDDINGS_BASE_URL", "https://api.nan.builders/v1");
    vi.stubEnv("EMBEDDINGS_MODEL", "qwen3-embedding");
    // Sin EMBEDDINGS_DIM no arranca: la dimensión no se puede adivinar.
    expect(() => getEmbeddingProvider()).toThrow(/EMBEDDINGS_DIM/);

    resetEmbeddingProvider();
    vi.stubEnv("EMBEDDINGS_DIM", "4096");
    const p = getEmbeddingProvider();
    expect(p.model).toBe("qwen3-embedding");
    expect(p.dim).toBe(4096);
  });

  it("rechaza una dimensión que no sea un entero positivo", () => {
    vi.stubEnv("EMBEDDINGS_PROVIDER", "openai-compatible");
    vi.stubEnv("EMBEDDINGS_API_KEY", "k");
    vi.stubEnv("EMBEDDINGS_BASE_URL", "https://x/v1");
    vi.stubEnv("EMBEDDINGS_MODEL", "m");
    vi.stubEnv("EMBEDDINGS_DIM", "4096.5");
    expect(() => getEmbeddingProvider()).toThrow(/entero positivo/);
  });

  it("el alias `nan` sigue funcionando con los defaults de NaN", () => {
    vi.stubEnv("EMBEDDINGS_PROVIDER", "nan");
    vi.stubEnv("NAN_API_KEY", "nan-key");
    const p = getEmbeddingProvider();
    expect(p.model).toBe("qwen3-embedding");
    expect(p.dim).toBe(4096);
  });

  it("un proveedor desconocido falla con la lista de opciones válidas", () => {
    vi.stubEnv("EMBEDDINGS_PROVIDER", "inventado");
    expect(() => getEmbeddingProvider()).toThrow(/local \| openai-compatible \| openai \| voyage/);
  });
});

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { getEmbeddingProvider, resetEmbeddingProvider } from "@cortex/embeddings";

/**
 * The embedding's dimension fixes the vector schema: if a wrong one slips through, the failure
 * appears late (on insert or, worse, when comparing vectors of different dimensions). That is
 * why the generic provider demands it explicitly. This pins that contract and the deprecated
 * `nan` alias's (ADR-0024).
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
  it("defaults to the local provider (startup with no keys)", () => {
    expect(getEmbeddingProvider().model).toBeTruthy();
  });

  it("openai-compatible requires a base URL, a model and a dimension", () => {
    vi.stubEnv("EMBEDDINGS_PROVIDER", "openai-compatible");
    vi.stubEnv("EMBEDDINGS_API_KEY", "k");
    vi.stubEnv("EMBEDDINGS_BASE_URL", "https://api.nan.builders/v1");
    vi.stubEnv("EMBEDDINGS_MODEL", "qwen3-embedding");
    // Without EMBEDDINGS_DIM it does not start: the dimension cannot be guessed.
    expect(() => getEmbeddingProvider()).toThrow(/EMBEDDINGS_DIM/);

    resetEmbeddingProvider();
    vi.stubEnv("EMBEDDINGS_DIM", "4096");
    const p = getEmbeddingProvider();
    expect(p.model).toBe("qwen3-embedding");
    expect(p.dim).toBe(4096);
  });

  it("rejects a dimension that is not a positive integer", () => {
    vi.stubEnv("EMBEDDINGS_PROVIDER", "openai-compatible");
    vi.stubEnv("EMBEDDINGS_API_KEY", "k");
    vi.stubEnv("EMBEDDINGS_BASE_URL", "https://x/v1");
    vi.stubEnv("EMBEDDINGS_MODEL", "m");
    vi.stubEnv("EMBEDDINGS_DIM", "4096.5");
    expect(() => getEmbeddingProvider()).toThrow(/positive integer/);
  });

  it("the `nan` alias still works, with NaN's defaults", () => {
    vi.stubEnv("EMBEDDINGS_PROVIDER", "nan");
    vi.stubEnv("NAN_API_KEY", "nan-key");
    const p = getEmbeddingProvider();
    expect(p.model).toBe("qwen3-embedding");
    expect(p.dim).toBe(4096);
  });

  it("an unknown provider fails, listing the valid options", () => {
    vi.stubEnv("EMBEDDINGS_PROVIDER", "inventado");
    expect(() => getEmbeddingProvider()).toThrow(/local \| openai-compatible \| openai \| voyage/);
  });
});

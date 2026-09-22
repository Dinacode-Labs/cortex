import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { getLlmConfig, getSttConfig, getVisionConfig, isLlmEnabled } from "@cortex/shared";

/**
 * The LLM provider stopped being a closed list of vendors (`nan`, `openrouter`) and became any
 * OpenAI-compatible endpoint (ADR-0024): that way NaN, Ollama, vLLM or LM Studio all work with
 * the same config. These tests pin the three pieces that introduces: the generic provider, the
 * `nan` compatibility alias, and per-role routing with `provider:model` (to send ONLY the
 * retriever somewhere else).
 */

// The provider env vars are global: clearing them keeps the repo's .env or an earlier test
// from deciding the result.
const VARS = [
  "LLM_PROVIDER", "LLM_BASE_URL", "LLM_API_KEY", "LLM_MODEL", "LLM_ALLOW_NO_KEY",
  "NAN_API_KEY", "NAN_BASE_URL", "NAN_LLM_MODEL",
  "OPENROUTER_API_KEY", "OPENROUTER_MODEL",
  "CORTEX_MODEL_RETRIEVER", "CORTEX_MODEL_DISTILLER", "CORTEX_VISION_MODEL",
  "CORTEX_STT_API_KEY", "CORTEX_STT_BASE_URL", "CORTEX_STT_MODEL", "OPENAI_API_KEY",
];

beforeEach(() => {
  for (const v of VARS) vi.stubEnv(v, "");
  vi.spyOn(console, "warn").mockImplementation(() => {});
});
afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

describe("getLlmConfig — proveedor openai-compatible", () => {
  it("with no LLM_PROVIDER it returns null (local heuristics)", () => {
    expect(getLlmConfig()).toBeNull();
    expect(isLlmEnabled()).toBe(false);
  });

  it("with no base URL there is no LLM, even with a key", () => {
    vi.stubEnv("LLM_PROVIDER", "openai-compatible");
    vi.stubEnv("LLM_API_KEY", "k-123");
    expect(getLlmConfig()).toBeNull();
  });

  it("with a base URL and a key it resolves endpoint, key and model", () => {
    vi.stubEnv("LLM_PROVIDER", "openai-compatible");
    vi.stubEnv("LLM_BASE_URL", "https://api.nan.builders/v1");
    vi.stubEnv("LLM_API_KEY", "k-123");
    vi.stubEnv("LLM_MODEL", "deepseek-v4-flash");
    expect(getLlmConfig()).toEqual({
      provider: "openai-compatible",
      apiKey: "k-123",
      model: "deepseek-v4-flash",
      baseURL: "https://api.nan.builders/v1",
    });
  });

  it("a local endpoint with no auth needs an explicit LLM_ALLOW_NO_KEY", () => {
    vi.stubEnv("LLM_PROVIDER", "openai-compatible");
    vi.stubEnv("LLM_BASE_URL", "http://localhost:11434/v1");
    expect(getLlmConfig()).toBeNull(); // a forgotten key must not pass as "local with no auth"

    vi.stubEnv("LLM_ALLOW_NO_KEY", "1");
    expect(getLlmConfig()?.baseURL).toBe("http://localhost:11434/v1");
  });
});

describe("getLlmConfig — alias obsoleto `nan`", () => {
  it("maps NAN_* onto the generic config and warns once", () => {
    vi.stubEnv("LLM_PROVIDER", "nan");
    vi.stubEnv("NAN_API_KEY", "nan-key");
    vi.stubEnv("NAN_LLM_MODEL", "deepseek-v4-flash");
    const cfg = getLlmConfig();
    expect(cfg).toEqual({
      provider: "openai-compatible",
      apiKey: "nan-key",
      model: "deepseek-v4-flash",
      baseURL: "https://api.nan.builders/v1",
    });
  });

  it("the generic variables beat the alias", () => {
    vi.stubEnv("LLM_PROVIDER", "nan");
    vi.stubEnv("NAN_API_KEY", "nan-key");
    vi.stubEnv("LLM_BASE_URL", "https://otro.endpoint/v1");
    expect(getLlmConfig()?.baseURL).toBe("https://otro.endpoint/v1");
  });
});

describe("getLlmConfig — routing por rol", () => {
  it("CORTEX_MODEL_<ROLE> changes only that role's model", () => {
    vi.stubEnv("LLM_PROVIDER", "openai-compatible");
    vi.stubEnv("LLM_BASE_URL", "https://api.nan.builders/v1");
    vi.stubEnv("LLM_API_KEY", "k");
    vi.stubEnv("LLM_MODEL", "deepseek-v4-flash");
    vi.stubEnv("CORTEX_MODEL_DISTILLER", "glm5.3-flash");
    expect(getLlmConfig("distiller")?.model).toBe("glm5.3-flash");
    expect(getLlmConfig("classifier")?.model).toBe("deepseek-v4-flash");
  });

  it("`provider:model` sends that role to another provider, with its credentials", () => {
    vi.stubEnv("LLM_PROVIDER", "openai-compatible");
    vi.stubEnv("LLM_BASE_URL", "https://api.nan.builders/v1");
    vi.stubEnv("LLM_API_KEY", "nan-key");
    vi.stubEnv("OPENROUTER_API_KEY", "or-key");
    vi.stubEnv("CORTEX_MODEL_RETRIEVER", "openrouter:x-ai/grok-4.5");

    expect(getLlmConfig("retriever")).toEqual({
      provider: "openrouter",
      apiKey: "or-key",
      model: "x-ai/grok-4.5",
      baseURL: "https://openrouter.ai/api/v1",
    });
    expect(getLlmConfig("classifier")?.baseURL).toBe("https://api.nan.builders/v1");
  });

  it("a model id with ':' that is not a known provider is respected (Ollama, for instance)", () => {
    vi.stubEnv("LLM_PROVIDER", "openai-compatible");
    vi.stubEnv("LLM_BASE_URL", "http://localhost:11434/v1");
    vi.stubEnv("LLM_ALLOW_NO_KEY", "1");
    vi.stubEnv("CORTEX_MODEL_DISTILLER", "llama3:8b");
    expect(getLlmConfig("distiller")?.model).toBe("llama3:8b");
  });

  it("when the role's provider has no credentials, that role ends up with no LLM", () => {
    vi.stubEnv("LLM_PROVIDER", "openai-compatible");
    vi.stubEnv("LLM_BASE_URL", "https://api.nan.builders/v1");
    vi.stubEnv("LLM_API_KEY", "nan-key");
    vi.stubEnv("CORTEX_MODEL_RETRIEVER", "openrouter:x-ai/grok-4.5");
    expect(getLlmConfig("retriever")).toBeNull();
  });
});

describe("vision and STT", () => {
  it("CORTEX_VISION_MODEL changes the model while keeping the endpoint", () => {
    vi.stubEnv("LLM_PROVIDER", "openai-compatible");
    vi.stubEnv("LLM_BASE_URL", "https://api.nan.builders/v1");
    vi.stubEnv("LLM_API_KEY", "k");
    vi.stubEnv("LLM_MODEL", "un-modelo-text-only");
    vi.stubEnv("CORTEX_VISION_MODEL", "deepseek-v4-flash");
    const v = getVisionConfig();
    expect(v?.model).toBe("deepseek-v4-flash");
    expect(v?.baseURL).toBe("https://api.nan.builders/v1");
  });

  it("STT is an endpoint of its own and can reuse the LLM's key", () => {
    vi.stubEnv("LLM_API_KEY", "k-llm");
    vi.stubEnv("CORTEX_STT_BASE_URL", "https://api.nan.builders/v1");
    vi.stubEnv("CORTEX_STT_MODEL", "whisper");
    expect(getSttConfig()).toEqual({
      apiKey: "k-llm",
      baseURL: "https://api.nan.builders/v1",
      model: "whisper",
    });
  });

  it("with no key at all there is no STT", () => {
    expect(getSttConfig()).toBeNull();
  });
});

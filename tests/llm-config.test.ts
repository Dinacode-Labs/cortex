import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { getLlmConfig, getSttConfig, getVisionConfig, isLlmEnabled } from "@cortex/shared";

/**
 * El proveedor de LLM dejó de ser una lista cerrada de vendors (`nan`, `openrouter`) para
 * ser un endpoint OpenAI-compatible cualquiera (ADR-0024): así valen NaN, Ollama, vLLM o
 * LM Studio con la misma config. Estos tests fijan las tres piezas que eso introduce:
 * el proveedor genérico, el alias de compatibilidad `nan`, y el routing por rol con
 * `proveedor:modelo` (para mandar SOLO el retriever a otro sitio).
 */

// Las env de proveedor son globales: limpiarlas evita que el .env del repo o un test
// anterior decidan el resultado.
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
  it("sin LLM_PROVIDER devuelve null (heurísticas locales)", () => {
    expect(getLlmConfig()).toBeNull();
    expect(isLlmEnabled()).toBe(false);
  });

  it("sin base URL no hay LLM, aunque haya clave", () => {
    vi.stubEnv("LLM_PROVIDER", "openai-compatible");
    vi.stubEnv("LLM_API_KEY", "k-123");
    expect(getLlmConfig()).toBeNull();
  });

  it("con base URL y clave resuelve endpoint, clave y modelo", () => {
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

  it("un endpoint local sin auth necesita LLM_ALLOW_NO_KEY explícito", () => {
    vi.stubEnv("LLM_PROVIDER", "openai-compatible");
    vi.stubEnv("LLM_BASE_URL", "http://localhost:11434/v1");
    expect(getLlmConfig()).toBeNull(); // una key olvidada no debe pasar por "local sin auth"

    vi.stubEnv("LLM_ALLOW_NO_KEY", "1");
    expect(getLlmConfig()?.baseURL).toBe("http://localhost:11434/v1");
  });
});

describe("getLlmConfig — alias obsoleto `nan`", () => {
  it("mapea NAN_* a la config genérica y avisa una vez", () => {
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

  it("las variables genéricas ganan al alias", () => {
    vi.stubEnv("LLM_PROVIDER", "nan");
    vi.stubEnv("NAN_API_KEY", "nan-key");
    vi.stubEnv("LLM_BASE_URL", "https://otro.endpoint/v1");
    expect(getLlmConfig()?.baseURL).toBe("https://otro.endpoint/v1");
  });
});

describe("getLlmConfig — routing por rol", () => {
  it("CORTEX_MODEL_<ROL> cambia solo el modelo de ese rol", () => {
    vi.stubEnv("LLM_PROVIDER", "openai-compatible");
    vi.stubEnv("LLM_BASE_URL", "https://api.nan.builders/v1");
    vi.stubEnv("LLM_API_KEY", "k");
    vi.stubEnv("LLM_MODEL", "deepseek-v4-flash");
    vi.stubEnv("CORTEX_MODEL_DISTILLER", "glm5.3-flash");
    expect(getLlmConfig("distiller")?.model).toBe("glm5.3-flash");
    expect(getLlmConfig("classifier")?.model).toBe("deepseek-v4-flash");
  });

  it("`proveedor:modelo` manda ese rol a otro proveedor, con sus credenciales", () => {
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
    // El resto sigue en el proveedor base.
    expect(getLlmConfig("classifier")?.baseURL).toBe("https://api.nan.builders/v1");
  });

  it("un id de modelo con ':' que no sea un proveedor conocido se respeta (p. ej. Ollama)", () => {
    vi.stubEnv("LLM_PROVIDER", "openai-compatible");
    vi.stubEnv("LLM_BASE_URL", "http://localhost:11434/v1");
    vi.stubEnv("LLM_ALLOW_NO_KEY", "1");
    vi.stubEnv("CORTEX_MODEL_DISTILLER", "llama3:8b");
    expect(getLlmConfig("distiller")?.model).toBe("llama3:8b");
  });

  it("si el proveedor del rol no tiene credenciales, ese rol se queda sin LLM", () => {
    vi.stubEnv("LLM_PROVIDER", "openai-compatible");
    vi.stubEnv("LLM_BASE_URL", "https://api.nan.builders/v1");
    vi.stubEnv("LLM_API_KEY", "nan-key");
    vi.stubEnv("CORTEX_MODEL_RETRIEVER", "openrouter:x-ai/grok-4.5"); // sin OPENROUTER_API_KEY
    expect(getLlmConfig("retriever")).toBeNull();
  });
});

describe("visión y STT", () => {
  it("CORTEX_VISION_MODEL cambia el modelo manteniendo el endpoint", () => {
    vi.stubEnv("LLM_PROVIDER", "openai-compatible");
    vi.stubEnv("LLM_BASE_URL", "https://api.nan.builders/v1");
    vi.stubEnv("LLM_API_KEY", "k");
    vi.stubEnv("LLM_MODEL", "un-modelo-text-only");
    vi.stubEnv("CORTEX_VISION_MODEL", "deepseek-v4-flash");
    const v = getVisionConfig();
    expect(v?.model).toBe("deepseek-v4-flash");
    expect(v?.baseURL).toBe("https://api.nan.builders/v1");
  });

  it("STT es un endpoint propio y puede reutilizar la clave del LLM", () => {
    vi.stubEnv("LLM_API_KEY", "k-llm");
    vi.stubEnv("CORTEX_STT_BASE_URL", "https://api.nan.builders/v1");
    vi.stubEnv("CORTEX_STT_MODEL", "whisper");
    expect(getSttConfig()).toEqual({
      apiKey: "k-llm",
      baseURL: "https://api.nan.builders/v1",
      model: "whisper",
    });
  });

  it("sin ninguna clave no hay STT", () => {
    expect(getSttConfig()).toBeNull();
  });
});

import { getEnv, loadEnv } from "./env.js";

/**
 * Configuración de LLM por endpoint OpenAI-compatible. Soporta varios proveedores
 * vía LLM_PROVIDER:
 *   - "nan"        -> servidor nan.builders (modelos free; OpenAI-compatible)
 *   - "openrouter" -> OpenRouter (DeepSeek, etc.)
 * Aquí solo vive la resolución de credenciales/modelo (compartida por la capa de
 * agentes Mastra y el extractor multimodal); las llamadas al LLM las hacen los
 * consumidores en @cortex/agents. Ver ADR-0006/0008/0015.
 */

export interface LlmConfig {
  provider: string;
  apiKey: string;
  model: string;
  baseURL: string;
}

/** Devuelve la config LLM si está habilitada, o null. */
export function getLlmConfig(): LlmConfig | null {
  loadEnv();
  const provider = getEnv("LLM_PROVIDER", "none").toLowerCase();
  if (provider === "nan") {
    const apiKey = process.env.NAN_API_KEY;
    if (!apiKey) return null;
    return {
      provider,
      apiKey,
      model: getEnv("NAN_LLM_MODEL", "qwen3.6"),
      baseURL: getEnv("NAN_BASE_URL", "https://api.nan.builders/v1"),
    };
  }
  if (provider === "openrouter") {
    const apiKey = process.env.OPENROUTER_API_KEY;
    if (!apiKey) return null;
    return {
      provider,
      apiKey,
      model: getEnv("OPENROUTER_MODEL", "deepseek/deepseek-v4-pro"),
      baseURL: "https://openrouter.ai/api/v1",
    };
  }
  return null;
}

export function isLlmEnabled(): boolean {
  return getLlmConfig() !== null;
}

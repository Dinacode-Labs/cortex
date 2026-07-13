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

/** Devuelve la config LLM si está habilitada, o null. Con `role`, el modelo se resuelve
 * por rol: `CORTEX_MODEL_<ROLE>` (p. ej. `CORTEX_MODEL_DISTILLER`) gana al default del
 * proveedor. Permite routing barato/potente por rol sin tocar código (ADR-0023). Sin
 * `role` (o sin esa var), usa el modelo por defecto del proveedor, como antes. */
export function getLlmConfig(role?: string): LlmConfig | null {
  loadEnv();
  const provider = getEnv("LLM_PROVIDER", "none").toLowerCase();
  const roleModel = role ? getEnv(`CORTEX_MODEL_${role.toUpperCase()}`, "").trim() : "";
  if (provider === "nan") {
    const apiKey = process.env.NAN_API_KEY;
    if (!apiKey) return null;
    return {
      provider,
      apiKey,
      model: roleModel || getEnv("NAN_LLM_MODEL", "qwen3.6"),
      baseURL: getEnv("NAN_BASE_URL", "https://api.nan.builders/v1"),
    };
  }
  if (provider === "openrouter") {
    const apiKey = process.env.OPENROUTER_API_KEY;
    if (!apiKey) return null;
    return {
      provider,
      apiKey,
      model: roleModel || getEnv("OPENROUTER_MODEL", "deepseek/deepseek-v4-pro"),
      baseURL: "https://openrouter.ai/api/v1",
    };
  }
  return null;
}

export function isLlmEnabled(): boolean {
  return getLlmConfig() !== null;
}

/** Config del modelo de VISIÓN (caption de imágenes / OCR). Mismo proveedor
 * OpenAI-compatible que el LLM de chat, pero con modelo propio: `CORTEX_VISION_MODEL`
 * permite apuntar a un modelo multimodal cuando el de chat es text-only (p. ej. DeepSeek
 * en OpenRouter, con visión vía `qwen/qwen3.5-flash-02-23`). Null si no hay LLM. */
export function getVisionConfig(): LlmConfig | null {
  const cfg = getLlmConfig();
  if (!cfg) return null;
  const model = getEnv("CORTEX_VISION_MODEL", "").trim();
  return model ? { ...cfg, model } : cfg;
}

export interface SttConfig {
  apiKey: string;
  baseURL: string;
  model: string;
}

/** Config de STT (transcripción de audio/vídeo, whisper). Endpoint PROPIO, desacoplado
 * del proveedor de chat: OpenRouter no sirve `/audio/transcriptions`, así que por defecto
 * va a OpenAI (`whisper-1`). Clave: `CORTEX_STT_API_KEY` o, en su defecto, `OPENAI_API_KEY`;
 * base URL `CORTEX_STT_BASE_URL` (def OpenAI); modelo `CORTEX_STT_MODEL` (def whisper-1).
 * Null si no hay clave. Para seguir en nan durante la transición: fijar las tres vars. */
export function getSttConfig(): SttConfig | null {
  loadEnv();
  const key = (process.env.CORTEX_STT_API_KEY ?? process.env.OPENAI_API_KEY ?? "").trim();
  if (!key) return null;
  return {
    apiKey: key,
    baseURL: getEnv("CORTEX_STT_BASE_URL", "https://api.openai.com/v1"),
    model: getEnv("CORTEX_STT_MODEL", "whisper-1"),
  };
}

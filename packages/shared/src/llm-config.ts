import { getEnv, loadEnv } from "./env.js";

/**
 * Resolución de credenciales/modelo del LLM. Todo endpoint soportado habla el dialecto
 * OpenAI (`/v1/chat/completions`), así que el proveedor es genérico y lo define la config:
 *
 *   LLM_PROVIDER=none               -> sin LLM (heurísticas locales)
 *   LLM_PROVIDER=openai-compatible  -> LLM_BASE_URL + LLM_API_KEY + LLM_MODEL
 *                                      (NaN, Ollama, vLLM, LM Studio, TGI…)
 *   LLM_PROVIDER=openrouter         -> OPENROUTER_API_KEY + OPENROUTER_MODEL
 *   LLM_PROVIDER=nan                -> ALIAS OBSOLETO de openai-compatible con los
 *                                      defaults de NaN. Se retira en v0.2.0.
 *
 * Aquí solo vive la resolución; las llamadas las hacen los consumidores en
 * @cortex/agents. Ver ADR-0006/0008/0015/0024.
 */

export interface LlmConfig {
  provider: string;
  apiKey: string;
  model: string;
  baseURL: string;
}

const NAN_BASE_URL = "https://api.nan.builders/v1";
const OPENROUTER_BASE_URL = "https://openrouter.ai/api/v1";

/** Proveedores que pueden aparecer como prefijo en `CORTEX_MODEL_<ROL>`. La lista es
 *  cerrada a propósito: un modelo puede llevar `:` en su id (Ollama usa `llama3:8b`),
 *  así que solo se interpreta como proveedor lo que sea un proveedor conocido. */
const KNOWN_PROVIDERS = new Set(["openai-compatible", "openrouter", "nan"]);

/** Defaults heredados de un alias de proveedor (hoy solo `nan`). */
interface AliasDefaults {
  baseURL?: string;
  apiKey?: string;
  model?: string;
}

let warnedNanAlias = false;

/** Traduce el proveedor declarado a uno canónico + los defaults que aporte el alias. */
function normalizeProvider(declared: string): { provider: string; defaults: AliasDefaults } {
  if (declared !== "nan") return { provider: declared, defaults: {} };
  if (!warnedNanAlias) {
    warnedNanAlias = true;
    console.warn(
      "[llm-config] LLM_PROVIDER=nan is deprecated: use LLM_PROVIDER=openai-compatible with " +
        "LLM_BASE_URL / LLM_API_KEY / LLM_MODEL (see .env.example). The alias is removed in v0.2.0.",
    );
  }
  // `||` en vez de getEnv: una env declarada pero vacía cuenta como "sin configurar"
  // (getEnv solo aplica su default cuando la variable no existe).
  return {
    provider: "openai-compatible",
    defaults: {
      baseURL: process.env.NAN_BASE_URL || NAN_BASE_URL,
      apiKey: process.env.NAN_API_KEY || undefined,
      model: process.env.NAN_LLM_MODEL || undefined,
    },
  };
}

/** Separa `proveedor:modelo` cuando el prefijo es un proveedor conocido. */
function splitModelSpec(spec: string): { provider?: string; model: string } {
  const i = spec.indexOf(":");
  if (i <= 0) return { model: spec };
  const prefix = spec.slice(0, i).toLowerCase();
  if (!KNOWN_PROVIDERS.has(prefix)) return { model: spec };
  return { provider: prefix, model: spec.slice(i + 1).trim() };
}

/** Construye la config de un proveedor concreto, o null si le faltan credenciales. */
function resolveProvider(provider: string, model: string, defaults: AliasDefaults): LlmConfig | null {
  if (provider === "openai-compatible") {
    const baseURL = (getEnv("LLM_BASE_URL", "").trim() || defaults.baseURL || "").trim();
    if (!baseURL) return null; // sin endpoint no hay LLM
    // `||` y no `??`: una env declarada pero VACÍA (`LLM_API_KEY=` en .env.example) significa
    // "sin configurar", así que debe caer al siguiente candidato.
    const apiKey = (process.env.LLM_API_KEY || defaults.apiKey || "").trim();
    // Endpoints locales (Ollama, LM Studio) no piden clave: hay que declararlo explícitamente
    // para que un despliegue no se quede sin LLM en silencio por una key olvidada.
    if (!apiKey && !getEnv("LLM_ALLOW_NO_KEY", "").trim()) return null;
    return {
      provider,
      apiKey: apiKey || "no-key",
      model: model || getEnv("LLM_MODEL", "").trim() || defaults.model || "deepseek-v4-flash",
      baseURL,
    };
  }
  if (provider === "openrouter") {
    const apiKey = (process.env.OPENROUTER_API_KEY ?? "").trim();
    if (!apiKey) return null;
    return {
      provider,
      apiKey,
      model: model || getEnv("OPENROUTER_MODEL", "deepseek/deepseek-v4-pro"),
      baseURL: OPENROUTER_BASE_URL,
    };
  }
  return null;
}

/**
 * Devuelve la config LLM si está habilitada, o null.
 *
 * Con `role`, el modelo sale de `CORTEX_MODEL_<ROLE>` (p. ej. `CORTEX_MODEL_DISTILLER`),
 * que gana al default del proveedor. El valor admite dos formas:
 *   - `modelo`              -> mismo proveedor, otro modelo
 *   - `proveedor:modelo`    -> OTRO proveedor para ese rol (p. ej.
 *                              `CORTEX_MODEL_RETRIEVER=openrouter:x-ai/grok-4.5`),
 *                              resuelto con sus propias credenciales.
 * Permite routing barato/potente por rol sin tocar código (ADR-0023/0024).
 */
export function getLlmConfig(role?: string): LlmConfig | null {
  loadEnv();
  const declared = (getEnv("LLM_PROVIDER", "none").trim() || "none").toLowerCase();
  const { provider: baseProvider, defaults } = normalizeProvider(declared);
  const spec = role ? getEnv(`CORTEX_MODEL_${role.toUpperCase()}`, "").trim() : "";
  const { provider: roleProvider, model: roleModel } = splitModelSpec(spec);
  if (!roleProvider) return resolveProvider(baseProvider, roleModel, defaults);
  // El rol apunta a otro proveedor: se resuelve con SUS credenciales, sin heredar los
  // defaults del alias del proveedor base (serían de otro endpoint).
  const { provider, defaults: roleDefaults } = normalizeProvider(roleProvider);
  return resolveProvider(provider, roleModel, roleDefaults);
}

export function isLlmEnabled(): boolean {
  return getLlmConfig() !== null;
}

/** Config del modelo de VISIÓN (caption de imágenes / OCR). Mismo endpoint que el LLM de
 * chat salvo que `CORTEX_VISION_MODEL` diga otra cosa: permite apuntar a un multimodal
 * cuando el de chat es text-only, y admite `proveedor:modelo` igual que los roles.
 * Null si no hay LLM. */
export function getVisionConfig(): LlmConfig | null {
  const model = getEnv("CORTEX_VISION_MODEL", "").trim();
  if (!model) return getLlmConfig();
  const { provider: visionProvider, model: visionModel } = splitModelSpec(model);
  if (visionProvider) {
    const { provider, defaults } = normalizeProvider(visionProvider);
    return resolveProvider(provider, visionModel, defaults);
  }
  const cfg = getLlmConfig();
  return cfg ? { ...cfg, model: visionModel } : null;
}

export interface SttConfig {
  apiKey: string;
  baseURL: string;
  model: string;
}

/** Config de STT (transcripción de audio/vídeo, whisper). Endpoint PROPIO, desacoplado del
 * proveedor de chat: no todos sirven `/audio/transcriptions` (OpenRouter no lo hace).
 * Clave: `CORTEX_STT_API_KEY` o, en su defecto, `LLM_API_KEY`/`OPENAI_API_KEY`; base URL
 * `CORTEX_STT_BASE_URL` (def. OpenAI); modelo `CORTEX_STT_MODEL` (def. whisper-1).
 * Con NaN: fijar las tres (`…/v1`, la key de NaN y `whisper`). Null si no hay clave. */
export function getSttConfig(): SttConfig | null {
  loadEnv();
  const key = (process.env.CORTEX_STT_API_KEY || process.env.LLM_API_KEY || process.env.OPENAI_API_KEY || "").trim();
  if (!key) return null;
  return {
    apiKey: key,
    baseURL: getEnv("CORTEX_STT_BASE_URL", "https://api.openai.com/v1"),
    model: getEnv("CORTEX_STT_MODEL", "whisper-1"),
  };
}

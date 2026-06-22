import { getEnv, loadEnv } from "@cortex/shared";

/**
 * Acceso a LLM por endpoint OpenAI-compatible (/v1/chat/completions). Soporta
 * varios proveedores vía LLM_PROVIDER:
 *   - "nan"        -> servidor nan.builders (modelos free; OpenAI-compatible)
 *   - "openrouter" -> OpenRouter (DeepSeek, etc.)
 * Para extracción estructurada usamos modo json_object (ver classify.ts).
 * Ver ADR-0006/0008 en docs/decisions.md.
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

export interface ChatMessage {
  role: "system" | "user" | "assistant";
  content: string;
}

interface ChatOptions {
  jsonObject?: boolean;
  maxTokens?: number;
  temperature?: number;
  signal?: AbortSignal;
}

/** Llamada a chat/completions. Devuelve el texto del primer choice. */
export async function chat(messages: ChatMessage[], opts: ChatOptions = {}): Promise<string> {
  const cfg = getLlmConfig();
  if (!cfg) throw new Error("LLM no habilitado (LLM_PROVIDER / API key).");

  const res = await fetch(`${cfg.baseURL.replace(/\/$/, "")}/chat/completions`, {
    method: "POST",
    headers: {
      authorization: `Bearer ${cfg.apiKey}`,
      "content-type": "application/json",
      "x-title": "Dinacode Cortex",
    },
    body: JSON.stringify({
      model: cfg.model,
      messages,
      ...(opts.jsonObject ? { response_format: { type: "json_object" } } : {}),
      max_tokens: opts.maxTokens ?? 1024,
      temperature: opts.temperature ?? 0.2,
    }),
    signal: opts.signal,
  });

  if (!res.ok) {
    throw new Error(`LLM ${cfg.provider} ${res.status}: ${await res.text()}`);
  }
  const json = (await res.json()) as {
    choices?: { message?: { content?: string } }[];
  };
  return json.choices?.[0]?.message?.content ?? "";
}

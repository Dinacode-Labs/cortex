import { getEnv, loadEnv } from "@cortex/shared";

/**
 * Acceso a LLM vía OpenRouter. Para extracción estructurada usamos el endpoint
 * directo en modo `json_object` (fiable con DeepSeek). Mastra se usa aparte para
 * generación de texto (ver synthesize.ts). Ver ADR-0006 en docs/decisions.md.
 */

const BASE_URL = "https://openrouter.ai/api/v1";

export interface LlmConfig {
  apiKey: string;
  model: string;
}

/** Devuelve la config LLM si está habilitada (LLM_PROVIDER=openrouter + key). */
export function getLlmConfig(): LlmConfig | null {
  loadEnv();
  const provider = getEnv("LLM_PROVIDER", "none").toLowerCase();
  if (provider !== "openrouter") return null;
  const apiKey = process.env.OPENROUTER_API_KEY;
  if (!apiKey) return null;
  return { apiKey, model: getEnv("OPENROUTER_MODEL", "deepseek/deepseek-v4-pro") };
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

/** Llamada cruda a chat/completions. Devuelve el texto del primer choice. */
export async function chat(
  messages: ChatMessage[],
  opts: ChatOptions = {},
): Promise<string> {
  const cfg = getLlmConfig();
  if (!cfg) throw new Error("LLM no habilitado (LLM_PROVIDER/OPENROUTER_API_KEY).");

  const res = await fetch(`${BASE_URL}/chat/completions`, {
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
    throw new Error(`OpenRouter ${res.status}: ${await res.text()}`);
  }
  const json = (await res.json()) as {
    choices?: { message?: { content?: string } }[];
  };
  return json.choices?.[0]?.message?.content ?? "";
}

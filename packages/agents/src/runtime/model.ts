import { createOpenAICompatible } from "@ai-sdk/openai-compatible";
import { Agent } from "@mastra/core/agent";
import { getLlmConfig } from "@cortex/shared";
import type { AgentRole } from "./roles.js";

export const JSON_ROLES = new Set<AgentRole>(["classifier", "graph", "reranker", "distiller", "reconciler"]);

// Some models do not honour Mastra's `structuredOutput` reliably, but with
// `response_format: json_object` they are fast and valid (ADR-0006/0015).
export const jsonFetch: typeof fetch = async (url, init) => {
  if (init?.body && typeof init.body === "string") {
    try {
      const b = JSON.parse(init.body);
      b.response_format = { type: "json_object" };
      init = { ...init, body: JSON.stringify(b) };
    } catch {
      /* non-JSON body: leave it as it is */
    }
  }
  return fetch(url as Parameters<typeof fetch>[0], init);
};

/**
 * One model PER ROLE: `getLlmConfig(role)` resolves CORTEX_MODEL_<ROLE> (ADR-0023), so
 * different roles can use different models (cheap for the mechanical work, powerful for the
 * judgement). Same OpenAI-compatible endpoint; only the model id changes. The JSON roles force
 * `response_format: json_object` through `jsonFetch`.
 */
export function buildAgent(role: AgentRole, instructions: string): Agent {
  const cfg = getLlmConfig(role)!; // not null: the caller checked getLlmConfig()
  return new Agent({
    id: `cortex-${role}`,
    name: `cortex-${role}`,
    instructions,
    model: createOpenAICompatible({
      name: cfg.provider,
      baseURL: cfg.baseURL,
      apiKey: cfg.apiKey,
      ...(JSON_ROLES.has(role) ? { fetch: jsonFetch } : {}),
    })(cfg.model),
  });
}

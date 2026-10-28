import { createOpenAICompatible } from "@ai-sdk/openai-compatible";
import { Agent } from "@mastra/core/agent";
import { RequestContext } from "@mastra/core/request-context";
import type { AgentRole } from "./roles.js";
import { getLlmConfig, noModelError, type LlmConfig } from "./llm-config.js";

export const JSON_ROLES = new Set<AgentRole>(["classifier", "graph", "reranker", "distiller", "reconciler", "judge", "editor"]);

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

const LLM_CONFIG = "cortex.llmConfig";

export function callingWith(cfg: LlmConfig): RequestContext {
  return new RequestContext([[LLM_CONFIG, cfg]]);
}

/**
 * One model PER ROLE (ADR-0023), so different roles can use different models (cheap for the
 * mechanical work, powerful for the judgement). The agents are registered once per process, so
 * the model is resolved on every call from the config `runAgent` hands it (`callingWith`): a
 * model saved from the web applies without restarting anything (ADR-0101). The JSON roles force
 * `response_format: json_object` through `jsonFetch`.
 */
export function buildAgent(role: AgentRole, instructions: string): Agent {
  return new Agent({
    id: `cortex-${role}`,
    name: `cortex-${role}`,
    instructions,
    model: ({ requestContext }) => {
      const cfg = (requestContext.get(LLM_CONFIG) as LlmConfig | undefined) ?? getLlmConfig(role);
      if (!cfg) throw noModelError(role);
      return createOpenAICompatible({
        name: cfg.provider,
        baseURL: cfg.baseURL,
        apiKey: cfg.apiKey,
        ...(JSON_ROLES.has(role) ? { fetch: jsonFetch } : {}),
      })(cfg.model);
    },
  });
}

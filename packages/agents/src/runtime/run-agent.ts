import { recordUsage } from "@cortex/core";
import { getLlmConfig, withLlmSlot } from "@cortex/shared";
import { JSON_ROLES } from "./model.js";
import { getAgent } from "./registry.js";
import type { AgentRole } from "./roles.js";

export async function runAgent(
  role: AgentRole,
  prompt: string,
  opts: { maxOutputTokens?: number; maxRetries?: number } = {},
): Promise<string> {
  const agent = getAgent(role);
  if (!agent) throw new Error("LLM not enabled (LLM_PROVIDER / API key).");
  // Everything the provider has to honour travels inside `modelSettings`: that is the only
  // channel @mastra/core 1.45 reads (`modelSettings?: Omit<CallSettings, "abortSignal">` in
  // dist/agent/agent.types.d.ts, spread into the model call by the loop), and the same keys at
  // the top level are dropped with no warning -- which is how the per-role caps stopped being
  // in force. `maxRetries` is the one this version does not honour from here either: it
  // overwrites it per model with the Agent's own (`maxRetries: modelConfig.maxRetries`,
  // default 0), so what is asked for below only applies the day that stops being true.
  const modelSettings: { maxRetries: number; maxOutputTokens?: number; temperature?: number } = {
    maxRetries: opts.maxRetries ?? 6,
  };
  if (opts.maxOutputTokens) modelSettings.maxOutputTokens = opts.maxOutputTokens;
  // The roles that answer JSON get no room to improvise: the same window has to yield the same
  // entry, and a creative model is what turns a parse into a retry.
  if (JSON_ROLES.has(role)) modelSettings.temperature = 0;
  const t0 = Date.now();
  // One slot per call: the provider caps concurrent requests per API key, and
  // enrich/maintain fires several in parallel (CORTEX_ENRICH_CONCURRENCY).
  const res = (await withLlmSlot(() => agent.generate(prompt, { modelSettings }))) as {
    text?: string;
    usage?: { inputTokens?: number; outputTokens?: number; totalTokens?: number; promptTokens?: number; completionTokens?: number };
    response?: { modelId?: string };
  };
  const cfg = getLlmConfig(role);
  const u = res.usage ?? {};
  if (cfg) {
    // We record the SERVED model (res.response.modelId) when it arrives, not the requested
    // one: that catches OpenRouter routing and silent provider degradation (ADR-0023, section
    // 6.3). It falls back to the model requested for the role.
    const servedModel = res.response?.modelId?.trim() || cfg.model;
    await recordUsage({
      operation: role,
      provider: cfg.provider,
      model: servedModel,
      inputTokens: u.inputTokens ?? u.promptTokens ?? 0,
      outputTokens: u.outputTokens ?? u.completionTokens ?? 0,
      totalTokens: u.totalTokens,
      durationMs: Date.now() - t0,
    });
  }
  return res.text ?? "";
}

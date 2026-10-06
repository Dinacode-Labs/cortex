import { port } from "../../composition.js";
import { estimateCostUsd, type TraceTree, type UsageRecord, type UsageSummary } from "../domain/usage.js";

/** Best-effort: it never throws, because observability must not break the pipeline. */
export async function recordUsage(r: UsageRecord): Promise<void> {
  try {
    const inputTokens = Math.max(0, Math.round(r.inputTokens ?? 0));
    const outputTokens = Math.max(0, Math.round(r.outputTokens ?? 0));
    await port("usage").record({
      kind: r.kind ?? "llm",
      provider: r.provider,
      model: r.model,
      operation: r.operation,
      project: r.project ?? null,
      inputTokens,
      outputTokens,
      totalTokens: Math.max(0, Math.round(r.totalTokens ?? inputTokens + outputTokens)),
      costUsd: estimateCostUsd(r.model, inputTokens, outputTokens),
      durationMs: r.durationMs ?? null,
    });
  } catch (e) {
    console.error("[usage] recordUsage failed (ignored):", (e as Error).message);
  }
}

export async function getUsageSummary(): Promise<UsageSummary> {
  return port("usage").summary();
}

export async function getRecentTraces(limit = 15): Promise<TraceTree[]> {
  return port("usage").recentTraces(limit);
}

import { port } from "../../composition.js";
import {
  DEFAULT_USAGE_PERIOD,
  estimateCostUsd,
  fillDays,
  periodDays,
  type TraceTree,
  type UsageFacets,
  type UsageRecord,
  type UsageSummary,
} from "../domain/usage.js";

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
      projectId: r.projectId ?? null,
      endpoint: r.endpoint ?? null,
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

export interface UsageQuery {
  days?: number;
  projectId?: string;
  endpoint?: string;
  now?: Date;
}

export async function getUsageSummary(query: UsageQuery = {}): Promise<UsageSummary> {
  const days = periodDays(query.days ?? DEFAULT_USAGE_PERIOD, query.now ?? new Date());
  const summary = await port("usage").summary({
    since: new Date(`${days[0]}T00:00:00Z`),
    projectId: query.projectId,
    endpoint: query.endpoint,
  });
  return { ...summary, daily: fillDays(days, summary.daily) };
}

export async function getUsageFacets(): Promise<UsageFacets> {
  return port("usage").facets();
}

export async function getRecentTraces(limit = 15): Promise<TraceTree[]> {
  return port("usage").recentTraces(limit);
}

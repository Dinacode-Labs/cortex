import { getSql } from "@cortex/database";
import { setEmbeddingUsageSink } from "@cortex/embeddings";
import { getEnv } from "@cortex/shared";

/**
 * AI cost/usage observability (ADR-0016). `recordUsage` records every call to the LLM (Mastra
 * Agents) and to embeddings with its tokens and an estimated cost from a per-model price
 * table. Free models = 0. Best-effort: it never throws (observability must not break the
 * pipeline).
 */

export interface UsageRecord {
  kind?: "llm" | "embedding";
  provider: string;
  model: string;
  operation: string;
  project?: string | null;
  inputTokens?: number;
  outputTokens?: number;
  totalTokens?: number;
  durationMs?: number;
}

/** Approximate public prices (USD per 1M tokens), as of 2026-07-13. For ESTIMATING cost
 * only; adjust to your contract/catalogue (they change fast). Anything unlisted counts as 0
 * and is warned about once (ADR-0021 / ADR-0023 section 6.3). */
const PRICING: Record<string, { in: number; out: number }> = {
  // NaN (monthly subscription: the marginal cost per token is 0). ADR-0024.
  "deepseek-v4-flash": { in: 0, out: 0 },
  "glm5.3-flash": { in: 0, out: 0 },
  "mimo-v2.5": { in: 0, out: 0 },
  "qwen3.8-flash": { in: 0, out: 0 },
  "qwen3.6": { in: 0, out: 0 },
  "qwen3-embedding": { in: 0, out: 0 },
  whisper: { in: 0, out: 0 },
  "gpt-4o-mini": { in: 0.15, out: 0.6 },
  "gpt-4o": { in: 2.5, out: 10 },
  "text-embedding-3-small": { in: 0.02, out: 0 },
  "text-embedding-3-large": { in: 0.13, out: 0 },
  // OpenRouter -- per-role routing (ADR-0023)
  "deepseek/deepseek-v4-pro": { in: 0.43, out: 0.87 },
  "deepseek/deepseek-v4-flash": { in: 0.08, out: 0.15 },
  "x-ai/grok-4.5": { in: 2.0, out: 6.0 },
  "anthropic/claude-sonnet-5": { in: 2.0, out: 10.0 },
  "qwen/qwen3.5-flash-02-23": { in: 0.07, out: 0.26 },
  "voyage-3": { in: 0.06, out: 0 },
  "voyage-3-lite": { in: 0.02, out: 0 },
};

const warnedUnpriced = new Set<string>();

let merged: Record<string, { in: number; out: number }> | undefined;

/** The effective table: the one in code plus whatever `CORTEX_PRICING_JSON` adds. It allows
 *  fixing a price or registering a new model without deploying (which closes ADR-0021's
 *  "revisit when"). Invalid JSON -> a warning and it is ignored: observability never breaks
 *  anything. */
function pricing(): Record<string, { in: number; out: number }> {
  if (merged) return merged;
  merged = { ...PRICING };
  const raw = getEnv("CORTEX_PRICING_JSON", "").trim();
  if (raw) {
    try {
      const extra = JSON.parse(raw) as Record<string, { in?: number; out?: number }>;
      for (const [model, p] of Object.entries(extra)) {
        if (typeof p?.in === "number" && typeof p?.out === "number") merged[model] = { in: p.in, out: p.out };
        else console.warn(`[usage] CORTEX_PRICING_JSON: invalid entry for "${model}" (in/out numbers expected).`);
      }
    } catch (e) {
      console.warn(`[usage] CORTEX_PRICING_JSON is not valid JSON and is ignored: ${(e as Error).message}`);
    }
  }
  return merged;
}

/** Tests only: forces `CORTEX_PRICING_JSON` to be read again. @internal */
export function resetPricingCache(): void {
  merged = undefined;
  warnedUnpriced.clear();
}

/** A call's estimated cost in USD. @internal (exported for tests) */
export function estimateCostUsd(model: string, inTok: number, outTok: number): number {
  const table = pricing();
  const p = table[model] ?? table[model.split("/").pop() ?? ""];
  if (!p) {
    if (!warnedUnpriced.has(model)) {
      warnedUnpriced.add(model);
      console.warn(`[usage] model with no price in PRICING: "${model}" -> estimated cost $0. Add it to usage.ts.`);
    }
    return 0;
  }
  return (inTok / 1_000_000) * p.in + (outTok / 1_000_000) * p.out;
}

export async function recordUsage(r: UsageRecord): Promise<void> {
  try {
    const input = Math.max(0, Math.round(r.inputTokens ?? 0));
    const output = Math.max(0, Math.round(r.outputTokens ?? 0));
    const total = Math.max(0, Math.round(r.totalTokens ?? input + output));
    const cost = estimateCostUsd(r.model, input, output);
    const sql = getSql();
    await sql`
      INSERT INTO llm_usage (kind, provider, model, operation, project, input_tokens, output_tokens, total_tokens, est_cost_usd, duration_ms)
      VALUES (${r.kind ?? "llm"}, ${r.provider}, ${r.model}, ${r.operation}, ${r.project ?? null},
              ${input}, ${output}, ${total}, ${cost}, ${r.durationMs ?? null})
    `;
  } catch (e) {
    console.error("[usage] recordUsage failed (ignored):", (e as Error).message);
  }
}

export interface UsageSummary {
  totals: { calls: number; inputTokens: number; outputTokens: number; totalTokens: number; costUsd: number };
  byOperation: { operation: string; kind: string; calls: number; totalTokens: number; costUsd: number }[];
  byModel: { model: string; provider: string; calls: number; totalTokens: number; costUsd: number }[];
  recent: { createdAt: string; operation: string; model: string; totalTokens: number; costUsd: number; project: string | null }[];
}

export async function getUsageSummary(): Promise<UsageSummary> {
  const sql = getSql();
  type R = Record<string, unknown>;
  const [tot] = (await sql`
    SELECT count(*)::int AS calls, coalesce(sum(input_tokens),0)::int AS input,
           coalesce(sum(output_tokens),0)::int AS output, coalesce(sum(total_tokens),0)::int AS total,
           coalesce(sum(est_cost_usd),0)::float8 AS cost FROM llm_usage`) as unknown as R[];
  const byOp = (await sql`
    SELECT operation, kind, count(*)::int AS calls, coalesce(sum(total_tokens),0)::int AS total,
           coalesce(sum(est_cost_usd),0)::float8 AS cost
    FROM llm_usage GROUP BY operation, kind ORDER BY total DESC`) as unknown as R[];
  const byModel = (await sql`
    SELECT model, provider, count(*)::int AS calls, coalesce(sum(total_tokens),0)::int AS total,
           coalesce(sum(est_cost_usd),0)::float8 AS cost
    FROM llm_usage GROUP BY model, provider ORDER BY total DESC`) as unknown as R[];
  const recent = (await sql`
    SELECT created_at, operation, model, total_tokens, est_cost_usd, project
    FROM llm_usage ORDER BY created_at DESC LIMIT 20`) as unknown as R[];

  const t = tot ?? {};
  return {
    totals: {
      calls: Number(t.calls ?? 0), inputTokens: Number(t.input ?? 0), outputTokens: Number(t.output ?? 0),
      totalTokens: Number(t.total ?? 0), costUsd: Number(t.cost ?? 0),
    },
    byOperation: byOp.map((r) => ({ operation: String(r.operation), kind: String(r.kind), calls: Number(r.calls), totalTokens: Number(r.total), costUsd: Number(r.cost) })),
    byModel: byModel.map((r) => ({ model: String(r.model), provider: String(r.provider), calls: Number(r.calls), totalTokens: Number(r.total), costUsd: Number(r.cost) })),
    recent: recent.map((r) => ({ createdAt: new Date(r.created_at as string).toISOString(), operation: String(r.operation), model: String(r.model), totalTokens: Number(r.total_tokens), costUsd: Number(r.est_cost_usd), project: (r.project as string) ?? null })),
  };
}

export interface TraceSpan {
  spanId: string;
  parentSpanId: string | null;
  name: string | null;
  spanType: string | null;
  entityName: string | null;
  model: string | null;
  inputTokens: number | null;
  outputTokens: number | null;
  durationMs: number | null;
  status: string | null;
}
export interface TraceTree {
  traceId: string;
  startedAt: string;
  rootName: string;
  totalDurationMs: number;
  totalTokens: number;
  spans: TraceSpan[];
}

export async function getRecentTraces(limit = 15): Promise<TraceTree[]> {
  const sql = getSql();
  type R = Record<string, unknown>;
  const rows = (await sql`
    WITH recent AS (
      SELECT trace_id, max(started_at) AS ts FROM ai_traces
      GROUP BY trace_id ORDER BY ts DESC LIMIT ${limit}
    )
    SELECT a.*, r.ts AS _ts FROM ai_traces a JOIN recent r ON r.trace_id = a.trace_id
    ORDER BY r.ts DESC, a.started_at ASC NULLS LAST
  `) as unknown as R[];

  const byTrace = new Map<string, TraceTree>();
  for (const r of rows) {
    const tid = String(r.trace_id);
    let t = byTrace.get(tid);
    if (!t) {
      t = { traceId: tid, startedAt: new Date(r._ts as string).toISOString(), rootName: "", totalDurationMs: 0, totalTokens: 0, spans: [] };
      byTrace.set(tid, t);
    }
    const span: TraceSpan = {
      spanId: String(r.span_id),
      parentSpanId: (r.parent_span_id as string) ?? null,
      name: (r.name as string) ?? null,
      spanType: (r.span_type as string) ?? null,
      entityName: (r.entity_name as string) ?? null,
      model: (r.model as string) ?? null,
      inputTokens: r.input_tokens == null ? null : Number(r.input_tokens),
      outputTokens: r.output_tokens == null ? null : Number(r.output_tokens),
      durationMs: r.duration_ms == null ? null : Number(r.duration_ms),
      status: (r.status as string) ?? null,
    };
    t.spans.push(span);
    if (!r.parent_span_id || r.span_type === "agent_run") {
      t.rootName = span.entityName || span.name || span.spanType || "traza";
      t.totalDurationMs = span.durationMs ?? t.totalDurationMs;
    }
    t.totalTokens += (span.inputTokens ?? 0) + (span.outputTokens ?? 0);
  }
  return [...byTrace.values()];
}

// Registering the sink is EXPLICIT: the entrypoints call it (directly or through
// @cortex/agents' wireLlm()). It used to run as a side effect of importing this module
// (import "./usage.js" from vectors/code), which made the accounting depend on import order.
let sinkRegistered = false;

/** Registers the sink that records embedding usage into llm_usage (idempotent).
 * Without it, operations that embed leave no cost trail. */
export function registerUsageSink(): void {
  if (sinkRegistered) return;
  sinkRegistered = true;
  setEmbeddingUsageSink((u) => {
    void recordUsage({
      kind: "embedding",
      provider: getEnv("EMBEDDINGS_PROVIDER", "local").toLowerCase(),
      model: u.model,
      operation: "embedding",
      inputTokens: u.totalTokens,
      totalTokens: u.totalTokens,
    });
  });
}

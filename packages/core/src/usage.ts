import { getSql } from "@cortex/database";
import { setEmbeddingUsageSink } from "@cortex/embeddings";
import { getEnv } from "@cortex/shared";

/**
 * Observabilidad de coste/uso de IA (ADR-0016). `recordUsage` registra cada llamada
 * al LLM (Agents de Mastra) y a embeddings con sus tokens y una estimación de coste
 * según una tabla de precios por modelo. nan (modelos free) = 0. Best-effort: nunca
 * lanza (la observabilidad no debe romper el pipeline).
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

/** Precios públicos aproximados (USD por 1M tokens). Solo para ESTIMAR coste si se
 * cambia de proveedor; ajustar según contrato. Lo no listado se cuenta como 0. */
const PRICING: Record<string, { in: number; out: number }> = {
  // nan.builders (modelos free)
  "qwen3.6": { in: 0, out: 0 },
  "qwen3-embedding": { in: 0, out: 0 },
  // OpenAI (referencia)
  "gpt-4o-mini": { in: 0.15, out: 0.6 },
  "gpt-4o": { in: 2.5, out: 10 },
  "text-embedding-3-small": { in: 0.02, out: 0 },
  "text-embedding-3-large": { in: 0.13, out: 0 },
  // DeepSeek vía OpenRouter (referencia)
  "deepseek/deepseek-v4-pro": { in: 0.28, out: 0.88 },
  // Voyage (referencia)
  "voyage-3": { in: 0.06, out: 0 },
  "voyage-3-lite": { in: 0.02, out: 0 },
};

function estimateCostUsd(model: string, inTok: number, outTok: number): number {
  const p = PRICING[model] ?? PRICING[model.split("/").pop() ?? ""] ?? { in: 0, out: 0 };
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
    console.error("[usage] recordUsage falló (ignorado):", (e as Error).message);
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

// --- Trazas de IA (observabilidad B: spans de Mastra en ai_traces) -----------
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

/** Últimas N trazas (árbol de spans por trace_id), recientes primero. */
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

// Registra el uso de embeddings (el paquete embeddings emite tokens vía su sink).
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

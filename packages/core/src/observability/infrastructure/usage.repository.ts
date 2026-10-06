import type { Sql } from "@cortex/database";
import type { TraceSpan, TraceTree, UsageEntry, UsageRepository, UsageSummary } from "../domain/usage.js";

export class PgUsageRepository implements UsageRepository {
  constructor(private readonly sql: Sql) {}

  async record(e: UsageEntry): Promise<void> {
    await this.sql`
      INSERT INTO llm_usage (kind, provider, model, operation, project, input_tokens, output_tokens, total_tokens, est_cost_usd, duration_ms)
      VALUES (${e.kind}, ${e.provider}, ${e.model}, ${e.operation}, ${e.project},
              ${e.inputTokens}, ${e.outputTokens}, ${e.totalTokens}, ${e.costUsd}, ${e.durationMs})
    `;
  }

  async summary(): Promise<UsageSummary> {
    const sql = this.sql;
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

  async recentTraces(limit: number): Promise<TraceTree[]> {
    const sql = this.sql;
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
}

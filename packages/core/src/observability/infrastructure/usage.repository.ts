import type { Row, Sql, SqlFragment } from "@cortex/database";
import type {
  TraceSpan,
  TraceTree,
  UsageEntry,
  UsageFacets,
  UsageFigures,
  UsageFilter,
  UsageRepository,
  UsageSummary,
} from "../domain/usage.js";

// bigint, not int: a year of a busy installation runs past 2^31 tokens, and an int sum then errors.
const figuresOf = (r: Row): UsageFigures => ({
  calls: Number(r.calls ?? 0),
  inputTokens: Number(r.input ?? 0),
  outputTokens: Number(r.output ?? 0),
  totalTokens: Number(r.total ?? 0),
  costUsd: Number(r.cost ?? 0),
});

export class PgUsageRepository implements UsageRepository {
  constructor(private readonly sql: Sql) {}

  async record(e: UsageEntry): Promise<void> {
    await this.sql`
      INSERT INTO llm_usage (kind, provider, model, operation, project_id, endpoint, input_tokens, output_tokens, total_tokens, est_cost_usd, duration_ms)
      VALUES (${e.kind}, ${e.provider}, ${e.model}, ${e.operation}, ${e.projectId}, ${e.endpoint},
              ${e.inputTokens}, ${e.outputTokens}, ${e.totalTokens}, ${e.costUsd}, ${e.durationMs})
    `;
  }

  async summary(filter: UsageFilter): Promise<UsageSummary> {
    const sql = this.sql;
    const figures = sql`count(*)::int AS calls, coalesce(sum(u.input_tokens),0)::bigint AS input,
      coalesce(sum(u.output_tokens),0)::bigint AS output, coalesce(sum(u.total_tokens),0)::bigint AS total,
      coalesce(sum(u.est_cost_usd),0)::float8 AS cost`;
    const where = this.where(filter);

    const [totals, daily, byProject, byEndpoint, byOperation, byModel, recent] = (await Promise.all([
      sql`SELECT ${figures} FROM llm_usage u ${where}`,
      sql`SELECT to_char(date_trunc('day', u.created_at AT TIME ZONE 'UTC'), 'YYYY-MM-DD') AS day, ${figures}
          FROM llm_usage u ${where} GROUP BY 1 ORDER BY 1`,
      sql`SELECT u.project_id, e.name, e.slug, ${figures}
          FROM llm_usage u LEFT JOIN entities e ON e.id = u.project_id ${where}
          GROUP BY u.project_id, e.name, e.slug ORDER BY total DESC`,
      sql`SELECT u.endpoint, array_agg(DISTINCT u.provider ORDER BY u.provider) AS providers, ${figures}
          FROM llm_usage u ${where} GROUP BY u.endpoint ORDER BY total DESC`,
      sql`SELECT u.operation, u.kind, ${figures} FROM llm_usage u ${where} GROUP BY u.operation, u.kind ORDER BY total DESC`,
      sql`SELECT u.model, u.provider, ${figures} FROM llm_usage u ${where} GROUP BY u.model, u.provider ORDER BY total DESC`,
      sql`SELECT u.created_at, u.operation, u.model, u.total_tokens, u.est_cost_usd, u.endpoint, e.name AS project_name
          FROM llm_usage u LEFT JOIN entities e ON e.id = u.project_id ${where}
          ORDER BY u.created_at DESC LIMIT 20`,
    ])) as unknown as Row[][];

    return {
      totals: figuresOf(totals![0] ?? {}),
      daily: daily!.map((r) => ({ day: String(r.day), ...figuresOf(r) })),
      byProject: byProject!.map((r) => ({
        projectId: (r.project_id as string) ?? null,
        name: (r.name as string) ?? null,
        slug: (r.slug as string) ?? null,
        ...figuresOf(r),
      })),
      byEndpoint: byEndpoint!.map((r) => ({ endpoint: (r.endpoint as string) ?? null, providers: (r.providers as string[]) ?? [], ...figuresOf(r) })),
      byOperation: byOperation!.map((r) => ({ operation: String(r.operation), kind: String(r.kind), ...figuresOf(r) })),
      byModel: byModel!.map((r) => ({ model: String(r.model), provider: String(r.provider), ...figuresOf(r) })),
      recent: recent!.map((r) => ({
        createdAt: new Date(r.created_at as string).toISOString(),
        operation: String(r.operation),
        model: String(r.model),
        totalTokens: Number(r.total_tokens),
        costUsd: Number(r.est_cost_usd),
        projectName: (r.project_name as string) ?? null,
        endpoint: (r.endpoint as string) ?? null,
      })),
    };
  }

  async facets(): Promise<UsageFacets> {
    const sql = this.sql;
    const [projects, endpoints] = (await Promise.all([
      sql`SELECT e.id, e.name, e.slug FROM entities e
          WHERE e.id IN (SELECT DISTINCT project_id FROM llm_usage WHERE project_id IS NOT NULL)
          ORDER BY lower(e.name)`,
      sql`SELECT DISTINCT endpoint FROM llm_usage WHERE endpoint IS NOT NULL ORDER BY endpoint`,
    ])) as unknown as Row[][];
    return {
      projects: projects!.map((r) => ({ id: String(r.id), name: String(r.name), slug: (r.slug as string) ?? null })),
      endpoints: endpoints!.map((r) => String(r.endpoint)),
    };
  }

  private where(filter: UsageFilter): SqlFragment {
    const sql = this.sql;
    let conditions = sql`WHERE u.created_at >= ${filter.since}`;
    if (filter.projectId) conditions = sql`${conditions} AND u.project_id = ${filter.projectId}`;
    if (filter.endpoint) conditions = sql`${conditions} AND u.endpoint = ${filter.endpoint}`;
    return conditions;
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

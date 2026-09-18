import { getSql } from "@cortex/database";

/**
 * Our own observability exporter (ADR-0016, part B): it receives the tracing events from the
 * Mastra Agents and persists every span (once it finishes) into the `ai_traces` table of our
 * Postgres. That gives us the span tree (agent_run -> model_generation -> model_inference...)
 * with latency, hierarchy, model and tokens, without depending on Mastra's own storage.
 * Best-effort: it never breaks the agent.
 *
 * It inserts immediately, per span (no buffer) -> reliable even in CLIs that end with
 * process.exit.
 */
export class CortexTraceExporter {
  readonly name = "cortex-traces";

  async exportTracingEvent(event: unknown): Promise<void> {
    try {
      const ev = event as { type?: string; exportedSpan?: Record<string, unknown>; span?: Record<string, unknown> };
      if (ev?.type !== "span_ended") return;
      const s = (ev.exportedSpan ?? ev.span) as Record<string, any> | undefined;
      if (!s || s.isEvent) return;
      if (s.type === "model_chunk" || s.type === "model_step") return; // ruido por token

      const attrs = (s.attributes ?? {}) as Record<string, any>;
      const usage = (attrs.usage ?? {}) as Record<string, any>;
      const start = s.startTime ? new Date(s.startTime) : null;
      const end = s.endTime ? new Date(s.endTime) : null;
      const durationMs = start && end ? end.getTime() - start.getTime() : null;
      const status = s.errorInfo ? "error" : "ok";

      await getSql()`
        INSERT INTO ai_traces (span_id, trace_id, parent_span_id, name, span_type, entity_name,
                               model, input_tokens, output_tokens, started_at, ended_at, duration_ms, status, attributes)
        VALUES (${s.id}, ${s.traceId}, ${s.parentSpanId ?? null}, ${s.name ?? null}, ${s.type ?? null},
                ${s.entityName ?? null}, ${attrs.model ?? attrs.responseModel ?? null},
                ${usage.inputTokens ?? null}, ${usage.outputTokens ?? null},
                ${start}, ${end}, ${durationMs}, ${status},
                ${getSql().json(attrs as Parameters<ReturnType<typeof getSql>["json"]>[0])})
        ON CONFLICT (span_id) DO NOTHING
      `;
    } catch (e) {
      console.error("[trace-exporter] fallo (ignorado):", (e as Error).message);
    }
  }

  async flush(): Promise<void> {}
  async shutdown(): Promise<void> {}
}

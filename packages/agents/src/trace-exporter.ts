import { getSql } from "@cortex/database";

/**
 * Exporter de observabilidad propio (ADR-0016, parte B): recibe los eventos de
 * tracing de los Agents de Mastra y persiste cada span (cuando termina) en la tabla
 * `ai_traces` de nuestra Postgres. Así tenemos el árbol de spans (agent_run →
 * model_generation → model_inference…) con latencia, jerarquía, modelo y tokens,
 * sin depender del storage propio de Mastra. Best-effort: nunca rompe el agente.
 *
 * Inserta de forma inmediata por span (sin buffer) → fiable también en CLIs que
 * terminan con process.exit.
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

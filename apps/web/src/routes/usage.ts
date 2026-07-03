import { Hono } from "hono";
import { html, raw } from "hono/html";
import { getRecentTraces, getUsageSummary } from "@cortex/core";
import { layout, type Html } from "../views/layout.js";
import type { WebEnv } from "../middleware/session.js";

/** Coste / uso de IA: tokens y coste por operación/modelo + trazas (ADR-0016). */
export const usageRoutes = new Hono<WebEnv>();

usageRoutes.get("/usage", async (c) => {
  const u = await getUsageSummary();
  const traces = await getRecentTraces(12);
  const num = (n: number) => n.toLocaleString("es-ES");
  const money = (n: number) => (n > 0 ? `$${n.toFixed(4)}` : "—");
  // raw(): fragmentos de ATRIBUTOS literales de este fichero (estilos de tabla
  // repetidos); no contienen datos de usuario/BD.
  const th = raw('style="text-align:left;padding:6px 10px;border-bottom:1px solid var(--color-border);font-size:12px;color:var(--color-text-muted)"');
  const td = raw('style="padding:6px 10px;border-bottom:1px solid var(--color-border)"');
  const tdr = raw('style="padding:6px 10px;border-bottom:1px solid var(--color-border);text-align:right;font-variant-numeric:tabular-nums"');
  const stat = (label: string, value: string) =>
    html`<div class="panel" style="flex:1;min-width:140px"><div class="sub">${label}</div><div style="font-size:24px;font-weight:700">${value}</div></div>`;

  const opRows = u.byOperation.map(
    (o) => html`<tr><td ${td}>${o.operation} <span class="sub">${o.kind}</span></td><td ${tdr}>${num(o.calls)}</td><td ${tdr}>${num(o.totalTokens)}</td><td ${tdr}>${money(o.costUsd)}</td></tr>`,
  );
  const modelRows = u.byModel.map(
    (m) => html`<tr><td ${td}>${m.model} <span class="sub">${m.provider}</span></td><td ${tdr}>${num(m.calls)}</td><td ${tdr}>${num(m.totalTokens)}</td><td ${tdr}>${money(m.costUsd)}</td></tr>`,
  );
  const recentRows = u.recent.map(
    (r) => html`<tr><td ${td}><span class="sub">${r.createdAt.replace("T", " ").slice(0, 19)}</span></td><td ${td}>${r.operation}</td><td ${td}>${r.model}</td><td ${tdr}>${num(r.totalTokens)}</td><td ${tdr}>${money(r.costUsd)}</td></tr>`,
  );
  const table = (head: Html, rows: Html[]) =>
    html`<table style="width:100%;border-collapse:collapse">${head}${rows.length ? rows : html`<tr><td ${td} colspan="5"><span class="sub">Sin datos todavía.</span></td></tr>`}</table>`;

  const spanRow = (s: (typeof traces)[number]["spans"][number]) => {
    const indent = s.parentSpanId ? 18 : 0;
    const toks = (s.inputTokens ?? 0) + (s.outputTokens ?? 0);
    return html`<div style="padding:3px 0;padding-left:${indent}px;border-bottom:1px solid var(--color-border);font-size:13px">
      <span class="sub" style="font-variant-numeric:tabular-nums">${s.spanType ?? ""}</span>
      ${(s.name ?? s.entityName ?? "").slice(0, 80)}
      ${s.durationMs != null ? html`<span class="sub"> · ${num(s.durationMs)}ms</span>` : ""}
      ${toks ? html`<span class="sub"> · ${num(toks)} tok</span>` : ""}
      ${s.status === "error" ? " ⚠️" : ""}</div>`;
  };
  const tracesHtml = traces.length
    ? html`${traces.map(
        (t) =>
          html`<div class="panel"><h2 style="font-size:15px;margin-bottom:6px">🧵 ${t.rootName}
            <span class="sub" style="font-weight:400"> · ${num(t.totalDurationMs)}ms · ${num(t.totalTokens)} tok · ${t.startedAt.replace("T", " ").slice(0, 19)}</span></h2>
            ${t.spans.map(spanRow)}</div>`,
      )}`
    : html`<div class="panel"><span class="sub">Sin trazas todavía. Ejecuta una operación con LLM (ask, enrich…).</span></div>`;

  const body = html`
    <p><a class="back" href="/">← Inicio</a></p>
    <h1>Coste / uso de IA</h1>
    <p class="sub">Observabilidad de tokens y coste por operación y modelo (ADR-0016). El coste se estima con precios públicos por modelo; <b>nan = gratis</b>, por eso $0 hoy.</p>
    <div class="row" style="display:flex;gap:12px;flex-wrap:wrap">
      ${stat("Llamadas", num(u.totals.calls))}
      ${stat("Tokens (total)", num(u.totals.totalTokens))}
      ${stat("Tokens in / out", `${num(u.totals.inputTokens)} / ${num(u.totals.outputTokens)}`)}
      ${stat("Coste estimado", money(u.totals.costUsd))}
    </div>
    <div class="panel"><h2>Por operación / agente</h2>${table(html`<tr><th ${th}>Operación</th><th ${th} style="text-align:right">Llamadas</th><th ${th} style="text-align:right">Tokens</th><th ${th} style="text-align:right">Coste</th></tr>`, opRows)}</div>
    <div class="panel"><h2>Por modelo</h2>${table(html`<tr><th ${th}>Modelo</th><th ${th} style="text-align:right">Llamadas</th><th ${th} style="text-align:right">Tokens</th><th ${th} style="text-align:right">Coste</th></tr>`, modelRows)}</div>
    <div class="panel"><h2>Últimas llamadas</h2>${table(html`<tr><th ${th}>Fecha</th><th ${th}>Operación</th><th ${th}>Modelo</th><th ${th} style="text-align:right">Tokens</th><th ${th} style="text-align:right">Coste</th></tr>`, recentRows)}</div>
    <h2 style="margin-top:28px">Trazas recientes <span class="sub">· AI tracing de Mastra (árbol de spans)</span></h2>
    ${tracesHtml}`;
  return c.html(layout("Coste IA", body, c.get("user")));
});

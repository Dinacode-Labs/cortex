import { Hono } from "hono";
import { html, raw } from "hono/html";
import { getRecentTraces, getUsageSummary } from "@cortex/core";
import { layout, type Html } from "../views/layout.js";
import type { WebEnv } from "../middleware/session.js";

/**
 * Coste / uso de IA: tokens y coste por operación/modelo + trazas (ADR-0016).
 *
 * Vive bajo `/admin` y **solo lo ven los admins** (ADR-0050). Es una cifra de toda la
 * instalación, sin filtrar por proyecto: lo que gasta la empresa en inferencia no es asunto de
 * cada developer que entra a revisar una decisión, y antes lo era.
 */
export const usageRoutes = new Hono<WebEnv>();

usageRoutes.get("/admin/usage", async (c) => {
  const user = c.get("user")!;
  if (!user.admin) {
    return c.html(
      layout("Not found", html`<p><a class="back" href="/">← Projects</a></p><div class="empty">Not found.</div>`, user),
      404,
    );
  }
  const u = await getUsageSummary();
  const traces = await getRecentTraces(12);
  const num = (n: number) => n.toLocaleString("en-US");
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
    html`<table style="width:100%;border-collapse:collapse">${head}${rows.length ? rows : html`<tr><td ${td} colspan="5"><span class="sub">No data yet.</span></td></tr>`}</table>`;

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
    : html`<div class="panel"><span class="sub">No traces yet. Run something that uses the LLM (ask, enrich…).</span></div>`;

  const body = html`
    <p><a class="back" href="/">← Projects</a></p>
    <h1>AI cost and usage</h1>
    <p class="sub">Tokens and estimated cost per operation and model (ADR-0016). Prices come from a table you can override with <code>CORTEX_PRICING_JSON</code>, so a model priced at zero shows up as zero.</p>
    <div class="row" style="display:flex;gap:12px;flex-wrap:wrap">
      ${stat("Calls", num(u.totals.calls))}
      ${stat("Tokens (total)", num(u.totals.totalTokens))}
      ${stat("Tokens in / out", `${num(u.totals.inputTokens)} / ${num(u.totals.outputTokens)}`)}
      ${stat("Estimated cost", money(u.totals.costUsd))}
    </div>
    <div class="panel"><h2>By operation and agent</h2>${table(html`<tr><th ${th}>Operation</th><th ${th} style="text-align:right">Calls</th><th ${th} style="text-align:right">Tokens</th><th ${th} style="text-align:right">Cost</th></tr>`, opRows)}</div>
    <div class="panel"><h2>By model</h2>${table(html`<tr><th ${th}>Model</th><th ${th} style="text-align:right">Calls</th><th ${th} style="text-align:right">Tokens</th><th ${th} style="text-align:right">Cost</th></tr>`, modelRows)}</div>
    <div class="panel"><h2>Latest calls</h2>${table(html`<tr><th ${th}>Date</th><th ${th}>Operation</th><th ${th}>Model</th><th ${th} style="text-align:right">Tokens</th><th ${th} style="text-align:right">Cost</th></tr>`, recentRows)}</div>
    <h2 style="margin-top:28px">Recent traces <span class="sub">· AI tracing, as a span tree</span></h2>
    ${tracesHtml}`;
  return c.html(layout("AI cost", body, { user, activo: "admin" }));
});

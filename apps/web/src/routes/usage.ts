import { Hono } from "hono";
import { html } from "hono/html";
import {
  DEFAULT_USAGE_PERIOD,
  getRecentTraces,
  getUsageFacets,
  getUsageSummary,
  isAdmin,
  USAGE_PERIODS,
  type TraceTree,
  type UsageFigures,
} from "@cortex/core";
import { layout, type Html } from "../views/layout.js";
import { adminTabs } from "../views/admin-nav.js";
import { empty, menu, panel, segmented, stat } from "../views/components.js";
import { compactNumber, dailyTokensChart, formatCount, formatUsd } from "../views/usage.js";
import type { WebEnv } from "../middleware/session.js";

/**
 * AI cost / usage: tokens and cost by day, project, subscription, operation and model, plus
 * traces (ADR-0016, ADR-0100).
 *
 * It lives under `/admin` and **only admins see it** (ADR-0050). What the company spends on
 * inference is not the business of every developer who drops in to review a decision, and it
 * used to be — so the split by project is here, not on each project's pages.
 */
export const usageRoutes = new Hono<WebEnv>();

const BASE = "/admin/usage";

const stamp = (iso: string): string => iso.replace("T", " ").slice(0, 19);

const figureCells = (f: UsageFigures): Html =>
  html`<td class="num">${formatCount(f.calls)}</td><td class="num">${formatCount(f.totalTokens)}</td><td class="num">${formatUsd(f.costUsd)}</td>`;

function figuresTable(firstColumn: string, rows: Html[]): Html {
  if (rows.length === 0) return empty("No calls in this period.");
  return html`<table>
    <tr><th>${firstColumn}</th><th class="num">Calls</th><th class="num">Tokens</th><th class="num">Cost</th></tr>
    ${rows}
  </table>`;
}

function traceHtml(t: TraceTree): Html {
  const spans = t.spans.map((s) => {
    const tokens = (s.inputTokens ?? 0) + (s.outputTokens ?? 0);
    return html`<div class="trace-span ${s.parentSpanId ? "child" : ""}">
      <span class="sub">${s.spanType ?? ""}</span>
      ${(s.name ?? s.entityName ?? "").slice(0, 80)}
      ${s.durationMs != null ? html`<span class="sub"> · ${formatCount(s.durationMs)}ms</span>` : ""}
      ${tokens ? html`<span class="sub"> · ${formatCount(tokens)} tok</span>` : ""}
      ${s.status === "error" ? " ⚠️" : ""}
    </div>`;
  });
  return panel(`🧵 ${t.rootName}`, html`${spans}`, {
    help: `${formatCount(t.totalDurationMs)}ms · ${formatCount(t.totalTokens)} tok · ${stamp(t.startedAt)}`,
  });
}

usageRoutes.get(BASE, async (c) => {
  const user = c.get("user")!;
  if (!isAdmin(user)) {
    return c.html(
      layout("Not found", html`<p><a class="back" href="/">← Projects</a></p><div class="empty">Not found.</div>`, user),
      404,
    );
  }

  const facets = await getUsageFacets();
  const days = USAGE_PERIODS.find((p) => String(p) === c.req.query("days")) ?? DEFAULT_USAGE_PERIOD;
  const project = facets.projects.find((p) => (p.slug ?? p.id) === c.req.query("project"));
  const endpoint = facets.endpoints.find((e) => e === c.req.query("endpoint"));

  const [u, traces] = await Promise.all([
    getUsageSummary({ days, projectId: project?.id, endpoint }),
    getRecentTraces(12),
  ]);

  const state: Record<string, string> = {
    days: days === DEFAULT_USAGE_PERIOD ? "" : String(days),
    project: project ? (project.slug ?? project.id) : "",
    endpoint: endpoint ?? "",
  };
  const withFilters = (extra: Record<string, string>) => {
    const qs = new URLSearchParams({ ...state, ...extra });
    for (const [k, v] of [...qs]) if (!v) qs.delete(k);
    return qs.toString() ? `${BASE}?${qs}` : BASE;
  };

  const controls = html`<div class="list-controls">
    ${segmented(
      "Period",
      USAGE_PERIODS.map((p) => ({ label: `${p} days`, href: withFilters({ days: p === DEFAULT_USAGE_PERIOD ? "" : String(p) }), on: p === days })),
    )}
    <div class="menus">
      ${menu("Project", project?.name ?? "all", [
        { label: "All projects", href: withFilters({ project: "" }), on: !project },
        ...facets.projects.map((p) => ({ label: p.name, href: withFilters({ project: p.slug ?? p.id }), on: p.id === project?.id })),
      ])}
      ${menu("Subscription", endpoint ?? "all", [
        { label: "All subscriptions", href: withFilters({ endpoint: "" }), on: !endpoint },
        ...facets.endpoints.map((e) => ({ label: e, href: withFilters({ endpoint: e }), on: e === endpoint })),
      ])}
    </div>
  </div>`;

  const byProject = u.byProject.map(
    (p) => html`<tr><td>${p.projectId
      ? html`<a href="${withFilters({ project: p.slug ?? p.projectId })}">${p.name ?? p.projectId}</a>`
      : html`<span class="faint">No project</span>`}</td>${figureCells(p)}</tr>`,
  );
  const byEndpoint = u.byEndpoint.map(
    (e) => html`<tr><td>${e.endpoint
      ? html`<a class="mono" href="${withFilters({ endpoint: e.endpoint })}">${e.endpoint}</a>`
      : html`<span class="faint">Unknown</span>`} <span class="sub">${e.providers.join(", ")}</span></td>${figureCells(e)}</tr>`,
  );
  const byOperation = u.byOperation.map((o) => html`<tr><td>${o.operation} <span class="sub">${o.kind}</span></td>${figureCells(o)}</tr>`);
  const byModel = u.byModel.map((m) => html`<tr><td>${m.model} <span class="sub">${m.provider}</span></td>${figureCells(m)}</tr>`);
  const recent = u.recent.length
    ? html`<table>
        <tr><th>Date</th><th>Operation</th><th>Model</th><th>Project</th><th>Subscription</th><th class="num">Tokens</th><th class="num">Cost</th></tr>
        ${u.recent.map(
          (r) => html`<tr><td><span class="sub">${stamp(r.createdAt)}</span></td><td>${r.operation}</td><td>${r.model}</td>
            <td>${r.projectName ?? html`<span class="faint">—</span>`}</td><td><span class="mono">${r.endpoint ?? "—"}</span></td>
            <td class="num">${formatCount(r.totalTokens)}</td><td class="num">${formatUsd(r.costUsd)}</td></tr>`,
        )}
      </table>`
    : empty("No calls in this period.");

  const scope = [project?.name, endpoint].filter(Boolean).join(" · ");
  const body = html`
    <p><a class="back" href="/">← Projects</a></p>
    <h1>AI cost and usage</h1>
    <p class="sub">Tokens and estimated cost of every call to a model (ADR-0016, ADR-0100). A subscription is the host a call went to. Prices come from a table you can override with <code>CORTEX_PRICING_JSON</code>, so a model priced at zero shows up as zero.</p>
    ${adminTabs("usage")}
    ${controls}
    <div class="stat-row">
      ${stat("Calls", formatCount(u.totals.calls))}
      ${stat("Tokens", compactNumber(u.totals.totalTokens))}
      ${stat("Tokens in / out", `${compactNumber(u.totals.inputTokens)} / ${compactNumber(u.totals.outputTokens)}`)}
      ${stat("Estimated cost", formatUsd(u.totals.costUsd))}
    </div>
    ${panel("Tokens per day", dailyTokensChart(u.daily), {
      help: `The last ${days} days${scope ? `, ${scope}` : ""}, in UTC. Hover a day for its calls and cost.`,
    })}
    ${panel("By project", figuresTable("Project", byProject), {
      help: "A call no single project asked for — a search across several, or one recorded before projects were — counts as No project.",
    })}
    ${panel("By subscription", figuresTable("Subscription", byEndpoint))}
    ${panel("By operation and agent", figuresTable("Operation", byOperation))}
    ${panel("By model", figuresTable("Model", byModel))}
    ${panel("Latest calls", recent)}
    <h2 class="section-title">Recent traces <span class="sub">· the span tree of each agent run, whatever the filters above</span></h2>
    ${traces.length ? html`${traces.map(traceHtml)}` : panel(null, empty("No traces yet. Run something that uses the LLM (ask, enrich…)."))}`;
  return c.html(layout("AI cost", body, { user, active: "admin" }));
});

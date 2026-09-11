import { Hono } from "hono";
import { html } from "hono/html";
import { lintProject, listAccessibleProjects } from "@cortex/core";
import { layout, type Html } from "../views/layout.js";
import { requireProject } from "../middleware/access.js";
import type { WebEnv } from "../middleware/session.js";

/** Lint del conocimiento: salud de la memoria del proyecto (loops §12 / LLM Wiki). */
export const lintRoutes = new Hono<WebEnv>();

lintRoutes.get("/lint", async (c) => {
  const projects = await listAccessibleProjects(c.get("user")?.email ?? null);
  const project = c.req.query("project") || projects[0]?.name || "";
  const denied = await requireProject(c, project);
  if (denied) return denied;
  const projectOptions = projects.map(
    (p) => html`<option value="${p.name}" ${project === p.name ? "selected" : ""}>${p.name} (${p.entryCount})</option>`,
  );

  let report: Html = html``;
  if (project) {
    try {
      const r = await lintProject(project);
      const card = (title: string, color: string, items: Html[]) =>
        html`<div class="panel"><h2>${title} <span class="badge" style="background:${color}1a;color:${color};border:1px solid ${color}55">${items.length}</span></h2>${items.length ? html`<ul style="margin:0;padding-left:18px">${items.map((i) => html`<li>${i}</li>`)}</ul>` : html`<span class="sub">Nothing to report.</span>`}</div>`;
      report = html`${[
        card("⚠️ Contradicciones", "#cf222e", r.contradictions.map((x) => html`${x.a} <b>⟷</b> ${x.b}`)),
        card("🕳️ Gaps: incidents with no decisions", "#bc4c00", r.gaps.map((g) => html`<b>${g.area}</b> <span class="sub">(${g.type})</span> — ${g.incidents} incidencias, 0 decisiones`)),
        card("🔁 Posibles duplicados", "#9a6700", r.duplicates.map((d) => html`(${d.score.toFixed(2)}) ${d.a} <b>≈</b> ${d.b}`)),
        card("🧩 Orphan entities", "#57606a", r.orphanEntities.map((e) => html`${e.type}: ${e.name}`)),
        html`<div class="panel"><h2>📉 Other</h2><div class="sub">Low confidence: <b>${r.lowConfidence}</b> · superseded or obsolete: <b>${r.staleHistorical}</b> · total entries: <b>${r.totalEntries}</b></div></div>`,
      ]}`;
    } catch {
      // requireProject ya cubrió el proyecto inexistente, pero lintProject aún lanza si
      // el proyecto desaparece ENTRE el guard y la query (carrera) — se conserva.
      report = html`<div class="empty">Project not found.</div>`;
    }
  }

  const body = html`
    <p><a class="back" href="/">← Home</a></p>
    <h1>Knowledge lint</h1>
    <p class="sub">Salud de la memoria del proyecto: contradicciones, huecos, duplicados, entidades huérfanas (loops §12 / patrón LLM Wiki).</p>
    <div class="panel">
      <form class="row" method="get" action="/lint">
        <select name="project">${projectOptions}</select>
        <button type="submit">Analyse</button>
      </form>
    </div>
    ${report}`;
  return c.html(layout("Lint", body, c.get("user")));
});

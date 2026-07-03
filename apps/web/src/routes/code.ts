import { Hono } from "hono";
import { html } from "hono/html";
import { listAccessibleProjects, searchProjectCode } from "@cortex/core";
import { layout, type Html } from "../views/layout.js";
import { badge } from "../views/components.js";
import { requireProject } from "../middleware/access.js";
import type { WebEnv } from "../middleware/session.js";

/** Búsqueda híbrida (semántica + léxica) sobre el código indexado. */
export const codeRoutes = new Hono<WebEnv>();

codeRoutes.get("/code", async (c) => {
  const q = c.req.query("q") ?? "";
  const projects = await listAccessibleProjects(c.get("user")?.email ?? null);
  const project = c.req.query("project") || projects[0]?.name || "";
  const denied = await requireProject(c, project);
  if (denied) return denied;
  const projectOptions = projects.map(
    (p) => html`<option value="${p.name}" ${project === p.name ? "selected" : ""}>${p.name}</option>`,
  );

  let results: Html = html``;
  if (q && project) {
    const hits = await searchProjectCode(q, project, 10);
    results = hits.length
      ? html`${hits.map((h) => {
          const body = h.content.startsWith("// ") ? h.content.slice(h.content.indexOf("\n") + 1) : h.content;
          return html`<div class="panel"><div class="card-head">${badge(h.score.toFixed(2), "#0099ff")} <b>${h.path}</b> <span class="sub">:${h.startLine}-${h.endLine} · ${h.language ?? ""}</span></div><pre class="content-block" style="overflow:auto"><code>${body}</code></pre></div>`;
        })}`
      : html`<div class="empty">Sin resultados. ¿Has indexado el repo? (pnpm --filter @cortex/core index-code)</div>`;
  }

  const body = html`
    <p><a class="back" href="/">← Inicio</a></p>
    <h1>Búsqueda de código</h1>
    <p class="sub">Búsqueda híbrida (semántica + léxica) sobre el código indexado del proyecto.</p>
    <div class="panel">
      <form class="row" method="get" action="/code">
        <input type="text" name="q" placeholder="p.ej. dónde se verifica el teléfono del usuario" value="${q}" required>
        <select name="project">${projectOptions}</select>
        <button type="submit">Buscar</button>
      </form>
    </div>
    ${q ? html`<h2 style="font-size:16px">"${q}"</h2>${results}` : ""}`;
  return c.html(layout("Código", body, c.get("user")));
});

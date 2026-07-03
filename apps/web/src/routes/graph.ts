import { Hono } from "hono";
import { html } from "hono/html";
import { checkProjectAccess, getProjectGraph, listAccessibleProjects } from "@cortex/core";
import { layout } from "../views/layout.js";
import { requireProject } from "../middleware/access.js";
import type { WebEnv } from "../middleware/session.js";

/** Grafo de conocimiento: página (con vis-network en /graph.js) + endpoint JSON. */
export const graphRoutes = new Hono<WebEnv>();

graphRoutes.get("/api/graph", async (c) => {
  const project = c.req.query("project") ?? "";
  // Endpoint JSON (lo consume la página /graph): misma política, respuesta JSON.
  if (project) {
    const access = await checkProjectAccess(c.get("user")?.email ?? null, { name: project });
    if (access.status === "not_found") return c.json({ error: "proyecto no encontrado" }, 404);
    if (access.status === "forbidden") return c.json({ error: "sin acceso" }, 403);
  }
  const includeEntries = c.req.query("entries") !== "0";
  const graph = await getProjectGraph(project, { includeEntries });
  return c.json(graph);
});

graphRoutes.get("/graph", async (c) => {
  const projects = await listAccessibleProjects(c.get("user")?.email ?? null);
  const project = c.req.query("project") || projects[0]?.name || "";
  const denied = await requireProject(c, project);
  if (denied) return denied;
  const includeEntries = c.req.query("entries") !== "0";
  const projectOptions = projects.map(
    (p) => html`<option value="${p.name}" ${project === p.name ? "selected" : ""}>${p.name} (${p.entryCount})</option>`,
  );

  const body = html`
    <p><a class="back" href="/">← Inicio</a></p>
    <h1>Grafo de conocimiento</h1>
    <p class="sub">Entidades (círculos por tipo) y entradas, unidas por relaciones y menciones. Arrastra, haz zoom, clic en una entrada para abrirla.</p>
    <div class="panel">
      <form class="row" method="get" action="/graph">
        <select name="project">${projectOptions}</select>
        <label style="display:flex;align-items:center;gap:6px;font-size:14px">
          <input type="checkbox" name="entries" value="1" ${includeEntries ? "checked" : ""}> incluir entradas
        </label>
        <button type="submit">Ver</button>
      </form>
      <div id="legend" style="margin-top:10px;font-size:12px;color:var(--color-text-muted)"></div>
    </div>
    <div id="net" style="height:72vh;background:var(--brand-ink);border:1px solid var(--color-border);border-radius:10px"></div>
    <script src="https://unpkg.com/vis-network@9.1.9/standalone/umd/vis-network.min.js"></script>
    <script src="/graph.js"></script>`;
  return c.html(layout("Grafo", body, c.get("user")));
});

import { Hono } from "hono";
import { html } from "hono/html";
import { contextEntryType } from "@cortex/shared";
import { listAccessibleProjects, listEntries } from "@cortex/core";
import { layout } from "../views/layout.js";
import { entryCard } from "../views/components.js";
import { requireProject } from "../middleware/access.js";
import type { WebEnv } from "../middleware/session.js";

/** Dashboard: listado de entradas con filtros por proyecto y tipo + captura. */
export const dashboardRoutes = new Hono<WebEnv>();

dashboardRoutes.get("/", async (c) => {
  const project = c.req.query("project");
  // Input de query validado con el enum del dominio (antes `as never`): inválido = ausente.
  const typeParsed = contextEntryType.safeParse(c.req.query("type"));
  const type = typeParsed.success ? typeParsed.data : undefined;
  const showCapture = c.req.query("capture") === "1";
  const email = c.get("user")?.email ?? null;

  const denied = await requireProject(c, project);
  if (denied) return denied;
  const projects = await listAccessibleProjects(email);
  let entries = await listEntries({
    project: project || undefined,
    type,
    limit: 60,
  });
  if (!project) {
    const ok = new Set(projects.map((p) => p.id));
    entries = entries.filter((e) => e.projectId && ok.has(e.projectId)); // no filtrar entre proyectos sin acceso
  }

  const projectPills = [
    html`<a class="pill ${!project ? "active" : ""}" href="/">Todos</a>`,
    ...projects.map(
      (p) =>
        html`<a class="pill ${project === p.name ? "active" : ""}" href="/?project=${encodeURIComponent(p.name)}">${p.name} (${p.entryCount})</a>`,
    ),
  ];

  const typePills = [
    html`<a class="pill ${!type ? "active" : ""}" href="/${project ? `?project=${encodeURIComponent(project)}` : ""}">Todos los tipos</a>`,
    ...contextEntryType.options.map((t) => {
      const qs = new URLSearchParams();
      if (project) qs.set("project", project);
      qs.set("type", t);
      return html`<a class="pill ${type === t ? "active" : ""}" href="/?${qs.toString()}">${t}</a>`;
    }),
  ];

  const captureForm = showCapture
    ? html`<div class="panel">
        <h2>Capturar contexto</h2>
        <form method="post" action="/save">
          <textarea name="content" placeholder="Escribe el conocimiento a guardar (decisión, restricción, incidencia...)" required></textarea>
          <div class="row" style="margin-top:8px">
            <input type="text" name="project" placeholder="Proyecto" value="${project ?? ""}">
            <select name="type">
              <option value="">(clasificar automáticamente)</option>
              ${contextEntryType.options.map((t) => html`<option value="${t}">${t}</option>`)}
            </select>
            <button type="submit">Guardar en Cortex</button>
          </div>
        </form>
      </div>`
    : html``;

  const packLink = project
    ? html`<a class="pill" href="/pack?project=${encodeURIComponent(project)}">📦 Context pack de ${project}</a>
       <a class="pill" href="/ask?project=${encodeURIComponent(project)}">💬 Preguntar sobre ${project}</a>`
    : html``;

  const body = html`
    <h1>Memoria de contexto</h1>
    <p class="sub">${entries.length} entradas · ${projects.length} proyectos</p>

    <div class="panel">
      <form class="row" method="get" action="/search">
        <input type="text" name="q" placeholder="Buscar semánticamente en Cortex..." required>
        ${project ? html`<input type="hidden" name="project" value="${project}">` : ""}
        <button type="submit">Buscar</button>
        <a href="/?capture=1${project ? `&project=${encodeURIComponent(project)}` : ""}"><button type="button" class="secondary">+ Capturar</button></a>
      </form>
    </div>

    ${captureForm}

    <div class="filters">
      <div>${projectPills}</div>
      <div style="margin-top:8px">${typePills}</div>
      ${project ? html`<div style="margin-top:8px">${packLink}</div>` : ""}
    </div>

    ${entries.length ? html`<div class="grid">${entries.map(entryCard)}</div>` : html`<div class="empty">No hay entradas con estos filtros.</div>`}
  `;
  return c.html(layout("Inicio", body, c.get("user")));
});

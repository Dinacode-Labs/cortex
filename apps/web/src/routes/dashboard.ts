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
  const entries = await listEntries({
    project: project || undefined,
    type,
    limit: 60,
    accessibleProjectIds: projects.map((p) => p.id), // en la consulta, no después (ADR-0052)
  });

  const projectPills = [
    html`<a class="pill ${!project ? "active" : ""}" href="/">All</a>`,
    ...projects.map(
      (p) =>
        html`<a class="pill ${project === p.name ? "active" : ""}" href="/?project=${encodeURIComponent(p.name)}">${p.name} (${p.entryCount})</a>`,
    ),
  ];

  const typePills = [
    html`<a class="pill ${!type ? "active" : ""}" href="/${project ? `?project=${encodeURIComponent(project)}` : ""}">All types</a>`,
    ...contextEntryType.options.map((t) => {
      const qs = new URLSearchParams();
      if (project) qs.set("project", project);
      qs.set("type", t);
      return html`<a class="pill ${type === t ? "active" : ""}" href="/?${qs.toString()}">${t}</a>`;
    }),
  ];

  const captureForm = showCapture
    ? html`<div class="panel">
        <h2>Capture context</h2>
        <form method="post" action="/save">
          <textarea name="content" placeholder="What should Cortex remember? A decision, a constraint, an incident…" required></textarea>
          <div class="row" style="margin-top:8px">
            <input type="text" name="project" placeholder="Project" value="${project ?? ""}">
            <select name="type">
              <option value="">(classify automatically)</option>
              ${contextEntryType.options.map((t) => html`<option value="${t}">${t}</option>`)}
            </select>
            <button type="submit">Save to Cortex</button>
          </div>
        </form>
      </div>`
    : html``;

  const packLink = project
    ? html`<a class="pill" href="/pack?project=${encodeURIComponent(project)}">📦 Context pack de ${project}</a>
       <a class="pill" href="/ask?project=${encodeURIComponent(project)}">💬 Preguntar sobre ${project}</a>`
    : html``;

  const body = html`
    <h1>Project memory</h1>
    <p class="sub">${entries.length} entradas · ${projects.length} proyectos</p>

    <div class="panel">
      <form class="row" method="get" action="/search">
        <input type="text" name="q" placeholder="Search Cortex by meaning…" required>
        ${project ? html`<input type="hidden" name="project" value="${project}">` : ""}
        <button type="submit">Search</button>
        <a href="/?capture=1${project ? `&project=${encodeURIComponent(project)}` : ""}"><button type="button" class="secondary">+ Capture</button></a>
      </form>
    </div>

    ${captureForm}

    <div class="filters">
      <div>${projectPills}</div>
      <div style="margin-top:8px">${typePills}</div>
      ${project ? html`<div style="margin-top:8px">${packLink}</div>` : ""}
    </div>

    ${entries.length ? html`<div class="grid">${entries.map(entryCard)}</div>` : html`<div class="empty">No entries match these filters.</div>`}
  `;
  return c.html(layout("Home", body, c.get("user")));
});

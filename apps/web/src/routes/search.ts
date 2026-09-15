import { Hono } from "hono";
import { html } from "hono/html";
import { searchContext } from "@cortex/core";
import { layout } from "../views/layout.js";
import { empty, hitCard, panel, searchForm } from "../views/components.js";
import { requireProject } from "../middleware/access.js";
import type { WebEnv } from "../middleware/session.js";

/** Búsqueda semántica sobre el contexto. */
export const searchRoutes = new Hono<WebEnv>();

searchRoutes.get("/search", async (c) => {
  const q = c.req.query("q") ?? "";
  const project = c.req.query("project");
  const denied = await requireProject(c, project);
  if (denied) return denied;
  // Scoping de seguridad: la web siempre tiene sesión. Con proyecto concreto el
  // requireProject de arriba ya controla el acceso; sin proyecto, restringimos la
  // búsqueda a los proyectos accesibles del usuario (no filtrar privados ajenos).
  const hits = q
    ? await searchContext(
        { query: q, project: project || undefined, limit: 15 },
        { restrictToAccessibleOf: c.get("user")?.email ?? null },
      )
    : [];

  const results = hits.length
    ? html`<div class="grid">${hits.map((h) => hitCard(h.entry, h.score))}</div>`
    : empty(q ? "Nothing relevant found. Try describing it differently — this searches by meaning." : "Type something to search for.");

  // La caja de búsqueda va también AQUÍ, no solo en la página de la que vienes: buscar es
  // afinar, y antes había que volver atrás para cambiar una palabra.
  const body = html`
    <div class="page-head">
      <h1>${q ? html`Results for "${q}"` : "Search"}</h1>
      <p class="sub">
        ${hits.length} ${hits.length === 1 ? "result" : "results"}${project ? html` in <b>${project}</b>` : ""} ·
        ranked by meaning, not by words
      </p>
    </div>
    ${panel(null, searchForm("/search", q, "Search by meaning…", project ? { project } : {}))}
    ${results}`;
  return c.html(layout(q ? `Search: ${q}` : "Search", body, { user: c.get("user"), q }));
});

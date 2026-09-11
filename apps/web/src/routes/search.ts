import { Hono } from "hono";
import { html } from "hono/html";
import { searchContext } from "@cortex/core";
import { layout } from "../views/layout.js";
import { badge, statusBadge, typeBadge } from "../views/components.js";
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
    ? html`<div class="grid">${hits.map(
        (h) =>
          html`<a class="card" href="/entry/${h.entry.id}">
            <div class="card-head">${badge(h.score.toFixed(2), "#0099ff")} ${typeBadge(h.entry.type)} ${statusBadge(h.entry.status)}</div>
            <h3>${h.entry.title}</h3>
            <p>${h.entry.summary ?? h.entry.content}</p>
          </a>`,
      )}</div>`
    : html`<div class="empty">${q ? "Nothing relevant found." : "Type a query."}</div>`;

  const body = html`
    <p><a class="back" href="/">← Home</a></p>
    <h1>Results for "${q}"</h1>
    <p class="sub">${hits.length} results${project ? html` · project ${project}` : ""} · ranked by similarity</p>
    ${results}`;
  return c.html(layout(`Search: ${q}`, body, c.get("user")));
});

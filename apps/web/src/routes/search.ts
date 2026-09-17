import { Hono } from "hono";
import { html } from "hono/html";
import { findProjectByName, listChildProjects, searchContext } from "@cortex/core";
import { layout, type Html } from "../views/layout.js";
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
  // Bajar a los hijos: solo desde el padre, solo los hijos que quien busca puede ver, y solo
  // si lo pide (ADR-0063). `listChildProjects` aplica el filtro de permisos, así que un repo
  // privado del que no eres miembro no entra en la búsqueda por venir del padre.
  const email = c.get("user")?.email ?? null;
  const padre = c.req.query("children") === "1" && project ? await findProjectByName(project) : null;
  const hijos = padre ? await listChildProjects(padre.id, email) : [];
  const hijoPorId = new Map(hijos.map((x) => [x.id, x]));

  const hits = q
    ? await searchContext(
        { query: q, project: project || undefined, limit: hijos.length ? 30 : 15 },
        { restrictToAccessibleOf: email, alsoProjectIds: hijos.map((x) => x.id) },
      )
    : [];

  // De qué proyecto es cada resultado, cuando hay más de uno en juego: si no, los de tres
  // repos distintos se leen como si fueran del mismo.
  const origen = (projectId: string | null): Html | undefined => {
    const hijo = projectId ? hijoPorId.get(projectId) : undefined;
    return hijo ? html`<span class="from-project">${hijo.name}</span>` : undefined;
  };

  const results = hits.length
    ? html`<div class="grid">${hits.map((x) => hitCard(x.entry, x.score, origen(x.entry.projectId)))}</div>`
    : empty(q ? "Nothing relevant found. Try describing it differently — this searches by meaning." : "Type something to search for.");

  // La caja de búsqueda va también AQUÍ, no solo en la página de la que vienes: buscar es
  // afinar, y antes había que volver atrás para cambiar una palabra.
  const body = html`
    <div class="page-head">
      <h1>${q ? html`Results for "${q}"` : "Search"}</h1>
      <p class="sub">
        ${hits.length} ${hits.length === 1 ? "result" : "results"}${project ? html` in <b>${project}</b>` : ""}${hijos.length
          ? html` and its ${hijos.length} child ${hijos.length === 1 ? "project" : "projects"}`
          : ""} ·
        ranked by meaning, not by words
      </p>
    </div>
    ${panel(
      null,
      searchForm(
        "/search",
        q,
        "Search by meaning…",
        project ? { project } : {},
        // Marcada: se llega aquí con la casilla ya puesta, y desmarcarla vuelve a buscar solo
        // en el padre. Sin esto, afinar la búsqueda perdía en silencio a los hijos.
        padre
          ? html`<label class="check"><input type="checkbox" name="children" value="1" checked> Include child projects</label>`
          : undefined,
      ),
    )}
    ${results}`;
  return c.html(layout(q ? `Search: ${q}` : "Search", body, { user: c.get("user"), q }));
});

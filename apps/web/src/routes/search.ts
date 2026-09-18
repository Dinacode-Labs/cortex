import { Hono } from "hono";
import { html } from "hono/html";
import { findProjectByName, listChildProjects, searchContext } from "@cortex/core";
import { layout, type Html } from "../views/layout.js";
import { empty, hitCard, panel, searchForm } from "../views/components.js";
import { requireProject } from "../middleware/access.js";
import type { WebEnv } from "../middleware/session.js";

/** Semantic search over the context. */
export const searchRoutes = new Hono<WebEnv>();

searchRoutes.get("/search", async (c) => {
  const q = c.req.query("q") ?? "";
  const project = c.req.query("project");
  const denied = await requireProject(c, project);
  if (denied) return denied;
  // Security scoping: the web always has a session. With a concrete project the requireProject
  // above already controls access; without one, the search is restricted to the user's
  // accessible projects (so other people's private ones do not leak).
  // Reaching down into the children: only from the parent, only the children the searcher can
  // see, and only when asked for (ADR-0063). `listChildProjects` applies the permission filter,
  // so a private repo you are not a member of does not enter the search via the parent.
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

  // Which project each result belongs to, when more than one is in play: otherwise results
  // from three different repos read as if they came from the same one.
  const origen = (projectId: string | null): Html | undefined => {
    const hijo = projectId ? hijoPorId.get(projectId) : undefined;
    return hijo ? html`<span class="from-project">${hijo.name}</span>` : undefined;
  };

  const results = hits.length
    ? html`<div class="grid">${hits.map((x) => hitCard(x.entry, x.score, origen(x.entry.projectId)))}</div>`
    : empty(q ? "Nothing relevant found. Try describing it differently — this searches by meaning." : "Type something to search for.");

  // The search box also lives HERE, not only on the page you came from: searching means
  // refining, and you used to have to go back to change a single word.
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
        // Checked: you arrive here with the box already ticked, and unticking it searches the
        // parent alone again. Without this, refining the search silently lost the children.
        padre
          ? html`<label class="check"><input type="checkbox" name="children" value="1" checked> Include child projects</label>`
          : undefined,
      ),
    )}
    ${results}`;
  return c.html(layout(q ? `Search: ${q}` : "Search", body, { user: c.get("user"), q }));
});

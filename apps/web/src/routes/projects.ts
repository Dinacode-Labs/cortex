import { Hono } from "hono";
import { html } from "hono/html";
import { addProjectMember, listAccessibleProjects, listProjectMembers, NotAManagerError, removeProjectMember } from "@cortex/core";
import { layout, type Html } from "../views/layout.js";
import { joinHtml } from "../views/components.js";
import type { WebEnv } from "../middleware/session.js";

/** Proyectos: listado por acceso + gestión de miembros del admin. */
export const projectsRoutes = new Hono<WebEnv>();

projectsRoutes.get("/projects", async (c) => {
  const user = c.get("user")!;
  const projects = await listAccessibleProjects(user.email); // admin → todos
  const cards = await Promise.all(
    projects.map(async (p) => {
      const vis = p.visibility === "private" ? html`<span class="pill" style="background:#fde">private</span>` : html`<span class="pill">public</span>`;
      const owner = p.ownerEmail ? html` · owner <code>${p.ownerEmail}</code>` : "";
      let members: Html = html``;
      if (user.admin && p.visibility === "private" && p.slug) {
        const list = await listProjectMembers(p.slug);
        const chips = list.map(
          (m) =>
            html`<form method="post" action="/projects/${p.slug!}/members/remove" style="display:inline">
                   <input type="hidden" name="email" value="${m}">
                   <span class="pill">${m} <button type="submit" title="remove" style="border:0;background:none;cursor:pointer;color:#c0392b">×</button></span>
                 </form>`,
        );
        members = html`<div style="margin-top:8px">
          <form method="post" action="/projects/${p.slug}/members" class="row" style="margin-bottom:6px">
            <input type="email" name="email" placeholder="add an email…" required>
            <button type="submit">Add member</button>
          </form>
          ${chips.length ? joinHtml(chips, " ") : html`<span class="sub">No members yet. Only the owner and admins.</span>`}
        </div>`;
      }
      return html`<div class="panel">
        <h2 style="margin-bottom:4px"><a href="/?project=${encodeURIComponent(p.name)}">${p.name}</a> ${vis}</h2>
        <div class="sub"><code>${p.slug ?? ""}</code>${owner}</div>
        ${members}
      </div>`;
    }),
  );
  const body = html`<p><a class="back" href="/">← Home</a></p>
    <h1>Projects</h1>
    <p class="sub">${user.admin ? "You are an admin: you see every project and manage access to the private ones." : "The projects you can access."}</p>
    ${cards.length ? cards : html`<div class="empty">You do not have access to any project yet.</div>`}`;
  return c.html(layout("Projects", body, user));
});

/** Quien manda ahora es el dominio (`canManageProject`): el dueño o un admin (ADR-0051). */
function paginaNoGestor(e: unknown, user: { email: string; admin: boolean }): Html {
  if (!(e instanceof NotAManagerError)) throw e;
  return layout("Not allowed", html`<div class="empty">${e.message}</div>`, user);
}

projectsRoutes.post("/projects/:slug/members", async (c) => {
  const user = c.get("user")!;
  const email = String((await c.req.parseBody()).email ?? "").trim();
  try {
    if (email) await addProjectMember(c.req.param("slug"), email, user.email);
  } catch (e) {
    return c.html(paginaNoGestor(e, user), 403);
  }
  return c.redirect("/projects");
});

projectsRoutes.post("/projects/:slug/members/remove", async (c) => {
  const user = c.get("user")!;
  const email = String((await c.req.parseBody()).email ?? "").trim();
  try {
    if (email) await removeProjectMember(c.req.param("slug"), email, user.email);
  } catch (e) {
    return c.html(paginaNoGestor(e, user), 403);
  }
  return c.redirect("/projects");
});

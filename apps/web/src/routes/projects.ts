import { Hono } from "hono";
import { html } from "hono/html";
import { addProjectMember, listAccessibleProjects, listProjectMembers, removeProjectMember } from "@cortex/core";
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
      const vis = p.visibility === "private" ? html`<span class="pill" style="background:#fde">privado</span>` : html`<span class="pill">público</span>`;
      const owner = p.ownerEmail ? html` · dueño <code>${p.ownerEmail}</code>` : "";
      let members: Html = html``;
      if (user.admin && p.visibility === "private" && p.slug) {
        const list = await listProjectMembers(p.slug);
        const chips = list.map(
          (m) =>
            html`<form method="post" action="/projects/${p.slug!}/members/remove" style="display:inline">
                   <input type="hidden" name="email" value="${m}">
                   <span class="pill">${m} <button type="submit" title="quitar" style="border:0;background:none;cursor:pointer;color:#c0392b">×</button></span>
                 </form>`,
        );
        members = html`<div style="margin-top:8px">
          <form method="post" action="/projects/${p.slug}/members" class="row" style="margin-bottom:6px">
            <input type="email" name="email" placeholder="añadir email…" required>
            <button type="submit">Añadir miembro</button>
          </form>
          ${chips.length ? joinHtml(chips, " ") : html`<span class="sub">Sin miembros (solo dueño y admins).</span>`}
        </div>`;
      }
      return html`<div class="panel">
        <h2 style="margin-bottom:4px"><a href="/?project=${encodeURIComponent(p.name)}">${p.name}</a> ${vis}</h2>
        <div class="sub"><code>${p.slug ?? ""}</code>${owner}</div>
        ${members}
      </div>`;
    }),
  );
  const body = html`<p><a class="back" href="/">← Inicio</a></p>
    <h1>Proyectos</h1>
    <p class="sub">${user.admin ? "Eres admin: ves todos y gestionas el acceso a los privados." : "Proyectos a los que tienes acceso."}</p>
    ${cards.length ? cards : html`<div class="empty">No tienes acceso a ningún proyecto todavía.</div>`}`;
  return c.html(layout("Proyectos", body, user));
});

projectsRoutes.post("/projects/:slug/members", async (c) => {
  const user = c.get("user")!;
  if (!user.admin) return c.html(layout("Sin permiso", html`<div class="empty">Solo un admin gestiona miembros.</div>`, user), 403);
  const email = String((await c.req.parseBody()).email ?? "").trim();
  if (email) await addProjectMember(c.req.param("slug"), email);
  return c.redirect("/projects");
});

projectsRoutes.post("/projects/:slug/members/remove", async (c) => {
  const user = c.get("user")!;
  if (!user.admin) return c.html(layout("Sin permiso", html`<div class="empty">Solo un admin gestiona miembros.</div>`, user), 403);
  const email = String((await c.req.parseBody()).email ?? "").trim();
  if (email) await removeProjectMember(c.req.param("slug"), email);
  return c.redirect("/projects");
});

import { Hono } from "hono";
import { html } from "hono/html";
import {
  addProjectMember,
  deleteProject,
  lintProject,
  listAccessibleProjects,
  listProjectMembers,
  NotAManagerError,
  ProjectNotEmptyError,
  removeProjectMember,
  updateProject,
} from "@cortex/core";
import { getBrandName } from "@cortex/shared";
import { layout, type Html } from "../views/layout.js";
import { projectHeader, visibilityPill } from "../views/project-nav.js";
import { requireProjectPage } from "../middleware/access.js";
import type { WebEnv } from "../middleware/session.js";

/**
 * La portada (lista de proyectos) y los ajustes de cada uno.
 *
 * La portada era antes un listado de entradas de todos los proyectos mezclados, que es la
 * pregunta que nadie se hace: quien abre la web viene pensando en un proyecto. Ahora lo primero
 * es elegirlo, y cada tarjeta dice lo que hace falta para elegir — cuánto sabe, si está
 * abierto o cerrado, y si tiene algo que revisar (ADR-0050).
 */
export const projectsRoutes = new Hono<WebEnv>();

/** Estado de salud resumido, para no entrar a un proyecto a ver si hay algo que mirar. */
async function salud(nombre: string): Promise<Html> {
  try {
    const r = await lintProject(nombre);
    const avisos = r.contradictions.length + r.duplicates.length;
    if (avisos === 0) return html`<span class="health ok">✓ healthy</span>`;
    return html`<span class="health warn">${avisos} to review</span>`;
  } catch {
    return html``;
  }
}

projectsRoutes.get("/", async (c) => {
  const user = c.get("user")!;
  const projects = await listAccessibleProjects(user.email);

  // `/?project=<nombre>` era la portada de un proyecto; ahora lo es `/p/<slug>` (ADR-0050).
  const viejo = c.req.query("project");
  if (viejo) {
    const p = projects.find((x) => x.name === viejo);
    if (p?.slug) return c.redirect(`/p/${p.slug}`, 301);
  }
  const saludes = await Promise.all(projects.map((p) => salud(p.name)));

  const cards = projects.map(
    (p, i) => html`
      <a class="project-card" href="/p/${p.slug}">
        <div class="card-head">
          <h2>${p.name}</h2>
          ${visibilityPill(p.visibility)}
        </div>
        <div class="owner">${p.ownerEmail ?? html`<span class="unclaimed">unclaimed</span>`}</div>
        <div class="card-foot">
          <span>${p.entryCount} ${p.entryCount === 1 ? "entry" : "entries"}</span>
          ${saludes[i]!}
        </div>
      </a>`,
  );

  // Un listado vacío no es un error: casi siempre es alguien que acaba de entrar. Decirle
  // "no tienes proyectos" no le sirve de nada; decirle cómo se crea el primero, sí.
  const vacio = html`<section class="panel onboarding">
    <h2>Nothing here yet</h2>
    <p class="sub">
      ${getBrandName()} fills itself from your coding sessions. Link a repository from its folder and your agents
      start feeding it:
    </p>
    <pre class="content-block">npm install -g @dinacodelabs/cortex
cortex auth login
cortex link --create "My Project"
cortex setup --all</pre>
    <p class="sub">If a project already exists and you cannot see it, it is private: ask its owner for access.</p>
  </section>`;

  const body = html`
    <div class="page-head">
      <h1>Projects</h1>
      <p class="sub">What ${getBrandName()} remembers, one project at a time.</p>
    </div>
    ${cards.length ? html`<div class="project-grid">${cards}</div>` : vacio}`;
  return c.html(layout("Projects", body, { user, activo: "projects" }));
});

// --- Ajustes del proyecto: visibilidad, dueño y miembros (ADR-0051) ---------------------

projectsRoutes.get("/p/:slug/settings", async (c) => {
  const user = c.get("user")!;
  const res = await requireProjectPage(c, c.req.param("slug"));
  if (res instanceof Response) return res;
  const { project, gestor } = res;

  // Quien no gestiona ve a quién pedirle las cosas, en vez de un 403 sin salida.
  if (!gestor) {
    const body = html`
      ${projectHeader(project, "settings", false)}
      <div class="panel">
        <h2>Access</h2>
        <p class="sub">
          This project is ${project.visibility}.
          ${project.ownerEmail
            ? html`It is managed by <b>${project.ownerEmail}</b> — ask them for changes.`
            : "It has no owner yet; an administrator can claim it."}
        </p>
      </div>`;
    return c.html(layout(`${project.name} · Access`, body, { user }));
  }

  const members = await listProjectMembers(project.slug!);
  const aviso = c.req.query("error");
  // Candidatos a padre: cualquier otro accesible con slug. La comprobación de ciclos la hace
  // el dominio, que es quien conoce toda la cadena de ancestros.
  const otros = (await listAccessibleProjects(user.email)).filter((o) => o.slug && o.id !== project.id);

  const body = html`
    ${projectHeader(project, "settings", true)}
    ${aviso ? html`<div class="warn">${aviso}</div>` : ""}

    <div class="panel">
      <h2>Visibility</h2>
      <p class="sub">
        A <b>public</b> project can be read by anyone signed in. A <b>private</b> one is limited to its owner, its
        members and administrators — in search, in context packs and everywhere else, immediately. Entries are not
        touched either way.
      </p>
      <form class="row" method="post" action="/p/${project.slug}/settings/visibility">
        <select name="visibility">
          <option value="public" ${project.visibility === "public" ? "selected" : ""}>public</option>
          <option value="private" ${project.visibility === "private" ? "selected" : ""}>private</option>
        </select>
        <button type="submit">Save</button>
      </form>
    </div>

    <div class="panel">
      <h2>Owner</h2>
      <p class="sub">The owner manages this project without needing to be an administrator.</p>
      <form class="row" method="post" action="/p/${project.slug}/settings/owner">
        <input type="email" name="ownerEmail" value="${project.ownerEmail ?? ""}" placeholder="nobody@example.com">
        <button type="submit">Save</button>
      </form>
    </div>

    <div class="panel">
      <h2>Parent project</h2>
      <p class="sub">
        A child inherits its parent's knowledge in what agents see, and its permissions: whoever can reach the
        parent can reach every child. Use it for a client with several repositories that are not a monorepo — the
        things that hold for all of them live once, in the parent.
      </p>
      <form class="row" method="post" action="/p/${project.slug}/settings/parent">
        <select name="parentSlug">
          <option value="">(none — top level)</option>
          ${otros.map((o) => html`<option value="${o.slug}" ${project.parentId === o.id ? "selected" : ""}>${o.name}</option>`)}
        </select>
        <button type="submit">Save</button>
      </form>
    </div>

    <div class="panel">
      <h2>Members</h2>
      <p class="sub">
        ${project.visibility === "private"
          ? "Who else can read this project."
          : "This project is public, so members change nothing today — they will the moment it goes private."}
      </p>
      <form class="row" method="post" action="/p/${project.slug}/members">
        <input type="email" name="email" placeholder="teammate@example.com" required>
        <button type="submit">Add member</button>
      </form>
      ${members.length
        ? html`<div class="chips">${members.map(
            (m) => html`<form method="post" action="/p/${project.slug}/members/remove" class="chip">
              <input type="hidden" name="email" value="${m}">
              <span>${m}</span><button type="submit" title="Remove">×</button>
            </form>`,
          )}</div>`
        : html`<span class="sub">No members yet. Only the owner and administrators.</span>`}
    </div>

    <div class="panel">
      <h2>Delete this project</h2>
      <p class="sub">
        ${project.entryCount === 0
          ? html`It holds nothing, so this only undoes creating it. A project with any memory in it cannot be
              deleted here — that is a decision to take slowly, with a backup.`
          : html`It holds <b>${project.entryCount}</b> ${project.entryCount === 1 ? "entry" : "entries"}, so it
              cannot be deleted here. Invalidating is not deleting: that is the whole point of the memory.`}
      </p>
      ${project.entryCount === 0
        ? html`<form method="post" action="/p/${project.slug}/settings/delete"
                 onsubmit="return confirm('Delete ${project.name}? It is empty, so nothing is lost.')">
              <button class="danger" type="submit">Delete project</button>
            </form>`
        : ""}
    </div>`;
  return c.html(layout(`${project.name} · Settings`, body, { user }));
});

/** Traduce el corte del dominio en una vuelta a la página con el motivo, no en un 500. */
function vuelveConError(slug: string, e: unknown): string {
  if (e instanceof NotAManagerError) return `/p/${slug}/settings?error=${encodeURIComponent(e.message)}`;
  throw e;
}

projectsRoutes.post("/p/:slug/settings/visibility", async (c) => {
  const user = c.get("user")!;
  const slug = c.req.param("slug");
  const v = String((await c.req.parseBody()).visibility ?? "");
  if (v !== "public" && v !== "private") return c.redirect(`/p/${slug}/settings`);
  try {
    await updateProject(slug, { visibility: v }, user.email);
  } catch (e) {
    return c.redirect(vuelveConError(slug, e));
  }
  return c.redirect(`/p/${slug}/settings`);
});

projectsRoutes.post("/p/:slug/settings/delete", async (c) => {
  const user = c.get("user")!;
  const slug = c.req.param("slug");
  try {
    await deleteProject(slug, user.email);
  } catch (e) {
    if (e instanceof NotAManagerError || e instanceof ProjectNotEmptyError) {
      return c.redirect(`/p/${slug}/settings?error=${encodeURIComponent((e as Error).message)}`);
    }
    throw e;
  }
  return c.redirect("/");
});

projectsRoutes.post("/p/:slug/settings/parent", async (c) => {
  const user = c.get("user")!;
  const slug = c.req.param("slug");
  const parentSlug = String((await c.req.parseBody()).parentSlug ?? "").trim() || null;
  try {
    await updateProject(slug, { parentSlug }, user.email);
  } catch (e) {
    if (e instanceof NotAManagerError) return c.redirect(vuelveConError(slug, e));
    // Padre inexistente o ciclo: el motivo se lee, no se traga.
    return c.redirect(`/p/${slug}/settings?error=${encodeURIComponent((e as Error).message)}`);
  }
  return c.redirect(`/p/${slug}/settings`);
});

projectsRoutes.post("/p/:slug/settings/owner", async (c) => {
  const user = c.get("user")!;
  const slug = c.req.param("slug");
  const email = String((await c.req.parseBody()).ownerEmail ?? "").trim();
  try {
    await updateProject(slug, { ownerEmail: email || null }, user.email);
  } catch (e) {
    return c.redirect(vuelveConError(slug, e));
  }
  return c.redirect(`/p/${slug}/settings`);
});

projectsRoutes.post("/p/:slug/members", async (c) => {
  const user = c.get("user")!;
  const slug = c.req.param("slug");
  const email = String((await c.req.parseBody()).email ?? "").trim();
  try {
    if (email) await addProjectMember(slug, email, user.email);
  } catch (e) {
    return c.redirect(vuelveConError(slug, e));
  }
  return c.redirect(`/p/${slug}/settings`);
});

projectsRoutes.post("/p/:slug/members/remove", async (c) => {
  const user = c.get("user")!;
  const slug = c.req.param("slug");
  const email = String((await c.req.parseBody()).email ?? "").trim();
  try {
    if (email) await removeProjectMember(slug, email, user.email);
  } catch (e) {
    return c.redirect(vuelveConError(slug, e));
  }
  return c.redirect(`/p/${slug}/settings`);
});

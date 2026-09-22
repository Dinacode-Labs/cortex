import { Hono } from "hono";
import { html } from "hono/html";
import {
  addProjectMember,
  deleteProject,
  listAccessibleProjects,
  listProjectMembers,
  NotAManagerError,
  ProjectNotEmptyError,
  removeProjectMember,
  updateProject,
} from "@cortex/core";
import { getBrandName } from "@cortex/shared";
import { layout, type Html } from "../views/layout.js";
import { projectCard } from "../views/components.js";
import { projectHealth } from "../project-summary.js";
import { projectHeader } from "../views/project-nav.js";
import { requireProjectPage } from "../middleware/access.js";
import type { WebEnv } from "../middleware/session.js";

/**
 * The home page used to be a list of entries from every project mixed together, which is the
 * question nobody asks: whoever opens the web arrives thinking about one project. Now the first
 * thing is to pick it, and each card says what is needed to pick -- how much it knows, whether
 * it is open or closed, and whether there is anything to review (ADR-0050).
 */
export const projectsRoutes = new Hono<WebEnv>();

projectsRoutes.get("/", async (c) => {
  const user = c.get("user")!;
  const projects = await listAccessibleProjects(user.email);

  // `/?project=<name>` used to be a project's home page; now `/p/<slug>` is (ADR-0050).
  const old = c.req.query("project");
  if (old) {
    const p = projects.find((x) => x.name === old);
    if (p?.slug) return c.redirect(`/p/${p.slug}`, 301);
  }
  const healths = await Promise.all(projects.map((p) => projectHealth(p.name)));
  const healthOf = new Map(projects.map((p, i) => [p.id, healths[i]!]));
  const card = (p: (typeof projects)[number]): Html => projectCard(p, healthOf.get(p.id) ?? html``);

  // Children are painted INSIDE their parent, not loose in the same list. A client with three
  // repos took up four sibling cards that gave no hint of having anything to do with each
  // other, and the relationship -- which pack inheritance and permissions hang off -- could
  // only be seen by going into Settings. Anyone without a hierarchy notices nothing: with no
  // children there are no groups and the grid is exactly what it was.
  const visible = new Set(projects.map((p) => p.id));
  const childrenOf = new Map<string, typeof projects>();
  for (const p of projects) {
    // A parent that is not in the list is not an orphan to hide: it is a top-level project for
    // whoever is looking. (It does not happen today -- seeing a child implies seeing its
    // parents -- but a listing that swallows projects would be a far worse bug than one that
    // flattens them.)
    if (!p.parentId || !visible.has(p.parentId)) continue;
    childrenOf.set(p.parentId, [...(childrenOf.get(p.parentId) ?? []), p]);
  }
  const roots = projects.filter((p) => !p.parentId || !visible.has(p.parentId));

  const groups = roots
    .filter((p) => childrenOf.has(p.id))
    .map(
      (p) => html`<section class="project-group">
        ${card(p)}
        <div class="project-children">
          <p class="sub">${childrenOf.get(p.id)!.length} project${childrenOf.get(p.id)!.length === 1 ? "" : "s"} in this client</p>
          <div class="project-grid">${childrenOf.get(p.id)!.map(card)}</div>
        </div>
      </section>`,
    );
  const standalone = roots.filter((p) => !childrenOf.has(p.id)).map(card);

  // An empty list is not an error: almost always it is somebody who has just arrived. Telling
  // them "you have no projects" helps nobody; telling them how to create the first one does.
  const emptyState = html`<section class="panel onboarding">
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
    ${projects.length
      ? html`${groups}${standalone.length ? html`<div class="project-grid">${standalone}</div>` : ""}`
      : emptyState}`;
  return c.html(layout("Projects", body, { user, active: "projects" }));
});

projectsRoutes.get("/p/:slug/settings", async (c) => {
  const user = c.get("user")!;
  const res = await requireProjectPage(c, c.req.param("slug"));
  if (res instanceof Response) return res;
  const { project, manager } = res;

  // Whoever cannot manage sees who to ask, rather than a dead-end 403.
  if (!manager) {
    const body = html`
      ${projectHeader(res, "settings")}
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
  const notice = c.req.query("error");
  // The cycle check is done by the domain, which is what knows the whole ancestor chain.
  const others = (await listAccessibleProjects(user.email)).filter((o) => o.slug && o.id !== project.id);

  const body = html`
    ${projectHeader(res, "settings")}
    ${notice ? html`<div class="warn">${notice}</div>` : ""}

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
          ${others.map((o) => html`<option value="${o.slug}" ${project.parentId === o.id ? "selected" : ""}>${o.name}</option>`)}
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

/** Turns the domain's refusal into a return to the page with the reason, not into a 500. */
function backWithError(slug: string, e: unknown): string {
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
    return c.redirect(backWithError(slug, e));
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
    if (e instanceof NotAManagerError) return c.redirect(backWithError(slug, e));
    // A non-existent parent or a cycle: the reason is shown, not swallowed.
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
    return c.redirect(backWithError(slug, e));
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
    return c.redirect(backWithError(slug, e));
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
    return c.redirect(backWithError(slug, e));
  }
  return c.redirect(`/p/${slug}/settings`);
});

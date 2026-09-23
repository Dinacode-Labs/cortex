import { Hono } from "hono";
import { html } from "hono/html";
import { contextEntryType, getBrandName, type ContextEntryStatus } from "@cortex/shared";
import {
  canManageEntryProject,
  checkEntryAccess,
  checkProjectAccess,
  findProjectByName,
  getEntryDetail,
  NotAManagerError,
  purgeEntries,
  saveContext,
  updateEntryFields,
  validateEntry,
} from "@cortex/core";
import { layout } from "../views/layout.js";
import { badge, confidenceBadge, panel, statusBadge, typeBadge } from "../views/components.js";
import { deniedPage } from "../middleware/access.js";
import type { WebEnv } from "../middleware/session.js";

export const entriesRoutes = new Hono<WebEnv>();

entriesRoutes.get("/entry/:id", async (c) => {
  const id = c.req.param("id");
  const access = await checkEntryAccess(c.get("user")?.email ?? null, id);
  if (access.status === "forbidden") return c.html(deniedPage(c.get("user")), 403);
  const detail = access.status === "ok" ? await getEntryDetail(id) : null;
  if (!detail) return c.html(layout("Not found", html`<p><a class="back" href="/">← Projects</a></p><div class="empty">Entry not found.</div>`), 404);
  const { entry, source, entities, projectName } = detail;

  const entityTags = entities.length
    ? html`<div class="tags">${entities.map((e) => html`<a href="/search?q=${encodeURIComponent(e.name)}">#${e.name} <small>(${e.type})</small></a>`)}</div>`
    : html`<span class="sub">No linked entities.</span>`;

  const validateForm = (status: ContextEntryStatus, label: string) =>
    html`<form method="post" action="/entry/${entry.id}/validate">
      <input type="hidden" name="status" value="${status}">
      <button class="${status === "rejected" ? "danger" : "secondary"}" type="submit">${label}</button>
    </form>`;

  const iso = (d: unknown) => (d instanceof Date ? d.toISOString().slice(0, 10) : String(d ?? "").slice(0, 10));
  const temporalBadge = entry.validTo
    ? badge(`no longer in force since ${iso(entry.validTo)}`, "#cf222e")
    : badge("in force", "#1a7f37");

  const project = projectName ? await findProjectByName(projectName) : null;
  const back = project?.slug ? `/p/${project.slug}` : "/";
  const editing = c.req.query("edit") === "1";
  const canPurge = await canManageEntryProject(c.get("user")?.email ?? null, access.status === "ok" ? access.project : null);
  const confirmingPurge = canPurge && c.req.query("purge") === "1";

  const body = html`
    <p><a class="back" href="${back}">← ${projectName ?? "Projects"}</a></p>
    <div class="card-head" style="margin-bottom:8px">${typeBadge(entry.type)} ${statusBadge(entry.status)} ${confidenceBadge(entry.confidence)} ${temporalBadge}</div>
    ${editing
      ? panel(
          "Edit",
          html`<form method="post" action="/entry/${entry.id}/edit">
            <input type="text" name="title" value="${entry.title}" required style="width:100%;margin-bottom:8px">
            <textarea name="content" rows="14" required>${entry.content}</textarea>
            <div class="row" style="margin-top:12px">
              <button type="submit">Save changes</button>
              <a class="button quiet" href="/entry/${entry.id}">Cancel</a>
            </div>
          </form>`,
          { help: "Correcting what an agent wrote is the point of this screen. The change is re-indexed, so it stays findable." },
        )
      : html`<div class="page-head row-between">
            <h1>${entry.title}</h1>
            <div class="row">
              <a class="button secondary" href="/entry/${entry.id}?edit=1">Edit</a>
              ${canPurge ? html`<a class="button danger" href="/entry/${entry.id}?purge=1">Purge</a>` : ""}
            </div>
          </div>
          ${confirmingPurge ? purgeConfirmation(entry.id) : ""}
          <div class="content-block">${entry.content}</div>`}

    ${panel("Metadata", html`<dl class="meta">
        <dt>Project</dt><dd>${projectName ?? "—"}</dd>
        <dt>Type</dt><dd>${entry.type}</dd>
        <dt>Status</dt><dd>${statusBadge(entry.status)}</dd>
        <dt>Confidence</dt><dd>${entry.confidence}</dd>
        <dt>Source</dt><dd>${entry.sourceType}${entry.sourceReference ? html` · ${entry.sourceReference}` : ""}</dd>
        <dt>Author</dt><dd>${entry.createdBy ?? "—"}</dd>
        <dt>Validity</dt><dd>${entry.validTo ? html`closed on ${iso(entry.validTo)} (${entry.validity})` : "in force"}</dd>
        <dt>Valid from</dt><dd>${iso(entry.validFrom)}</dd>
        <dt>Created</dt><dd>${entry.createdAt instanceof Date ? entry.createdAt.toISOString() : entry.createdAt}</dd>
    </dl>`)}
    ${panel("Related entities", entityTags)}

    ${source?.rawContent ? panel("Original source", html`<div class="content-block">${source.rawContent}</div>`) : ""}
    ${panel(
      "Is this still true?",
      html`<div class="row">
        ${validateForm("validated", "Yes, it holds")}
        ${validateForm("rejected", "No, it is wrong")}
        ${validateForm("obsolete", "It was, not any more")}
      </div>`,
      { help: "An agent wrote this. Saying so is what makes the rest of the memory worth trusting." },
    )}`;
  return c.html(layout(entry.title, body, c.get("user")));
});

/**
 * A second step rather than a `confirm()`: purging cannot be undone, so the page says what it
 * does before the button that does it, and it works without a script.
 */
function purgeConfirmation(entryId: string) {
  return panel(
    "Purge this entry for good?",
    html`<p>It will be deleted, not marked: it will not come back in search, in what agents see, in the map or in
        Health, and it cannot be restored. Only who purged it and when is kept, not what it said.</p>
      <p class="sub">If it is merely wrong or out of date, "No, it is wrong" or "It was, not any more" keeps the record.</p>
      <form method="post" action="/entry/${entryId}/purge" class="row" style="margin-top:12px">
        <button class="danger" type="submit">Purge permanently</button>
        <a class="button quiet" href="/entry/${entryId}">Cancel</a>
      </form>`,
  );
}

entriesRoutes.post("/entry/:id/purge", async (c) => {
  const id = c.req.param("id");
  const user = c.get("user");
  const access = await checkEntryAccess(user?.email ?? null, id);
  if (access.status === "not_found") return c.html(layout("Not found", html`<p><a class="back" href="/">← Projects</a></p><div class="empty">Entry not found.</div>`), 404);
  if (access.status === "forbidden") return c.html(deniedPage(user), 403);
  try {
    await purgeEntries([id], user?.email ?? null);
  } catch (e) {
    if (!(e instanceof NotAManagerError)) throw e;
    return c.html(
      layout("Not allowed", html`<p><a class="back" href="/entry/${id}">← Back to the entry</a></p><div class="empty">${e.message}</div>`, user),
      403,
    );
  }
  return c.redirect(access.project?.slug ? `/p/${access.project.slug}` : "/");
});

entriesRoutes.post("/entry/:id/validate", async (c) => {
  const id = c.req.param("id");
  // The same gate as the detail view (GET /entry/:id): without access to the entry's project,
  // its status cannot be changed.
  const access = await checkEntryAccess(c.get("user")?.email ?? null, id);
  if (access.status === "not_found") return c.html(layout("Not found", html`<p><a class="back" href="/">← Projects</a></p><div class="empty">Entry not found.</div>`), 404);
  if (access.status === "forbidden") return c.html(deniedPage(c.get("user")), 403);
  const form = await c.req.parseBody();
  const status = String(form.status) as "validated" | "rejected" | "obsolete";
  await validateEntry(id, status);
  return c.redirect(`/entry/${id}`);
});

entriesRoutes.post("/save", async (c) => {
  const user = c.get("user")!;
  const form = await c.req.parseBody();
  const content = String(form.content ?? "").trim();
  if (!content) return c.redirect("/");
  const project = String(form.project ?? "").trim() || undefined;
  // WRITE exception: a non-existent project is ALLOWED (saveContext auto-creates it, see the
  // ADR); only access to an existing restricted project is denied.
  if (project) {
    const access = await checkProjectAccess(user.email, { name: project });
    if (access.status === "forbidden") return c.html(deniedPage(user), 403);
  }
  // Form input validated against the domain enum (it used to be `as never`): invalid or empty
  // is treated as absent (automatic classification).
  const typeParsed = contextEntryType.safeParse(String(form.type ?? "").trim());
  const type = typeParsed.success ? typeParsed.data : undefined;

  const { entry, warnings } = await saveContext({ content, project, type, createdBy: user.email });

  const warnHtml = warnings.map(
    (w) => html`<div class="warn ${w.kind === "possible_contradiction" ? "contradiction" : ""}">⚠️ ${w.message}</div>`,
  );

  const destino = project ? (await findProjectByName(project))?.slug : null;
  const body = html`
    <p><a class="back" href="${destino ? `/p/${destino}` : "/"}">← ${project ?? "Projects"}</a></p>
    <h1>Saved to ${getBrandName()}</h1>
    <p class="sub">Classified as ${typeBadge(entry.type)} · status ${statusBadge(entry.status)}</p>
    ${warnings.length ? warnHtml : html`<p class="sub">Nothing worth flagging.</p>`}
    <p style="margin-top:16px">
      <a class="button" href="/entry/${entry.id}">View entry</a>
      ${destino ? html`<a class="button secondary" href="/p/${destino}?capture=1">Add another</a>` : ""}
    </p>`;
  return c.html(layout("Saved", body, c.get("user")));
});

entriesRoutes.post("/entry/:id/edit", async (c) => {
  const id = c.req.param("id");
  const access = await checkEntryAccess(c.get("user")?.email ?? null, id);
  if (access.status === "not_found")
    return c.html(layout("Not found", html`<p><a class="back" href="/">← Projects</a></p><div class="empty">Entry not found.</div>`), 404);
  if (access.status === "forbidden") return c.html(deniedPage(c.get("user")), 403);
  const form = await c.req.parseBody();
  const title = String(form.title ?? "").trim();
  const content = String(form.content ?? "").trim();
  if (title && content) await updateEntryFields(id, { title, content });
  return c.redirect(`/entry/${id}`);
});

import { Hono } from "hono";
import { html } from "hono/html";
import { contextEntryType, getBrandName } from "@cortex/shared";
import {
  canManageEntryProject,
  canReviewEntryProject,
  checkEntryAccess,
  checkProjectAccess,
  findProjectByName,
  getEntryDetail,
  isAwaitingReview,
  isReviewVerdict,
  NotAManagerError,
  purgeEntries,
  saveContext,
  updateEntryFields,
  validateEntry,
  type MemoReview,
  type ReviewVerdict,
} from "@cortex/core";
import { layout } from "../views/layout.js";
import { badge, confidenceMeter, panel, statusBadge, typeBadge, typeTag } from "../views/components.js";
import { projectPage } from "../views/project-nav.js";
import { deniedPage, requireProjectPage } from "../middleware/access.js";
import type { WebEnv } from "../middleware/session.js";

export const entriesRoutes = new Hono<WebEnv>();

entriesRoutes.get("/entry/:id", async (c) => {
  const id = c.req.param("id");
  const access = await checkEntryAccess(c.get("user"), id);
  if (access.status === "forbidden") return c.html(deniedPage(c.get("user")), 403);
  const detail = access.status === "ok" ? await getEntryDetail(id) : null;
  if (!detail) return c.html(layout("Not found", html`<p><a class="back" href="/">← Projects</a></p><div class="empty">Entry not found.</div>`), 404);
  const { entry, source, entities, projectName, reviews } = detail;

  const entityTags = entities.length
    ? html`<div class="tags">${entities.map((e) => html`<a href="/search?q=${encodeURIComponent(e.name)}">#${e.name} <small>(${e.type})</small></a>`)}</div>`
    : html`<span class="sub">No linked entities.</span>`;

  const validateForm = (status: ReviewVerdict, label: string) =>
    html`<form method="post" action="/entry/${entry.id}/validate">
      <input type="hidden" name="status" value="${status}">
      <button class="${status === "rejected" ? "danger" : "secondary"}" type="submit">${label}</button>
    </form>`;

  const iso = (d: unknown) => (d instanceof Date ? d.toISOString().slice(0, 10) : String(d ?? "").slice(0, 10));
  const temporalBadge = entry.validTo
    ? badge(`no longer in force since ${iso(entry.validTo)}`, "danger")
    : badge("in force", "ok");

  const project = projectName ? await findProjectByName(projectName) : null;
  const entryProject = access.status === "ok" ? access.project : null;
  const canReview = await canReviewEntryProject(c.get("user"), entryProject);
  const editing = canReview && c.req.query("edit") === "1";
  const canPurge = await canManageEntryProject(c.get("user"), entryProject);
  const confirmingPurge = canPurge && c.req.query("purge") === "1";
  const page = project?.slug ? await requireProjectPage(c, project.slug) : null;
  const projectView = page instanceof Response ? null : page;
  const waiting = projectView?.reviewer && entryProject ? await isAwaitingReview(entryProject, entry.id) : false;

  const main = html`
    ${editing
      ? panel(
          "Edit",
          html`<form method="post" action="/entry/${entry.id}/edit">
            <input type="text" name="title" value="${entry.title}" required aria-label="Title" class="wide">
            <textarea name="content" rows="14" required aria-label="Content">${entry.content}</textarea>
            <div class="row">
              <button type="submit">Save changes</button>
              <a class="button quiet" href="/entry/${entry.id}">Cancel</a>
            </div>
          </form>`,
          { help: "Correcting what an agent wrote is the point of this screen. The change is re-indexed, so it stays findable." },
        )
      : html`<div class="entry-heading">${typeTag(entry.type)}<span class="entry-source">${entry.sourceReference ?? entry.sourceType}</span>${temporalBadge}</div>
          <h1>${entry.title}</h1>
          <p class="prose">${entry.content}</p>
          ${canReview || canPurge
            ? html`<div class="row entry-actions">
                ${canReview ? html`<a class="button secondary" href="/entry/${entry.id}?edit=1">Edit</a>` : ""}
                ${canPurge ? html`<a class="button quiet danger-text" href="/entry/${entry.id}?purge=1">Purge…</a>` : ""}
              </div>`
            : ""}
          ${confirmingPurge ? purgeConfirmation(entry.id) : ""}`}
    <section class="entry-section">
      <h2 class="eyebrow">Related entities</h2>
      ${entityTags}
    </section>
    ${source?.rawContent
      ? html`<details class="entry-section source">
          <summary>Original source · ${entry.sourceType}</summary>
          <div class="content-block">${source.rawContent}</div>
        </details>`
      : ""}`;

  const aside = html`
    ${panel(
      "Is this still true?",
      canReview
        ? html`<div class="verdicts">
            ${validateForm("validated", "Yes, it holds")}
            ${validateForm("obsolete", "It was, not any more")}
            ${validateForm("rejected", "No, it is wrong")}
          </div>`
        : html`<p class="sub">${NOT_ON_THE_TEAM}</p>`,
      { help: "An agent may have written this. “Yes, it holds” marks it verified, and what is verified is what agents are told first." },
    )}
    ${panel(
      null,
      html`<h2 class="eyebrow">Details</h2>
        <dl class="facts">
          <dt>Status</dt><dd>${statusBadge(entry.status)}</dd>
          <dt>Confidence</dt><dd>${confidenceMeter(entry.confidence)}</dd>
          <dt>Validity</dt><dd>${entry.validTo ? html`closed on ${iso(entry.validTo)} (${entry.validity})` : "in force"}</dd>
          <dt>Valid from</dt><dd>${iso(entry.validFrom)}</dd>
          <dt>Source</dt><dd class="mono">${entry.sourceType}${entry.sourceReference ? html` · ${entry.sourceReference}` : ""}</dd>
          <dt>Author</dt><dd>${entry.createdBy ?? "—"}</dd>
          <dt>Created</dt><dd class="mono">${(entry.createdAt instanceof Date ? entry.createdAt.toISOString() : String(entry.createdAt)).slice(0, 16).replace("T", " ")} UTC</dd>
          <dt>Project</dt><dd>${projectName ?? "—"}</dd>
        </dl>`,
    )}
    ${panel(null, html`<h2 class="eyebrow">History</h2>${reviewHistory(reviews, iso)}`)}`;

  const notice = waiting
    ? html`<div class="notice-accent" role="note">
        <span>Something newer was saved about this memo. It is waiting in Review.</span>
        <a class="button secondary" href="/p/${project!.slug}/review">Compare them</a>
      </div>`
    : "";
  const back = project?.slug ? html`<a class="back" href="/p/${project.slug}">← Memory</a>` : html`<a class="back" href="/">← Projects</a>`;
  const body = html`${back}${notice}<div class="entry-layout"><article class="entry-main-col">${main}</article><aside class="entry-aside">${aside}</aside></div>`;
  return c.html(layout(entry.title, projectView ? projectPage(projectView, "memory", body, null) : body, c.get("user")));
});

function reviewHistory(reviews: MemoReview[], day: (d: unknown) => string) {
  if (!reviews.length) return html`<p class="sub">Nobody has reviewed it yet.</p>`;
  const where = (r: MemoReview) => (r.channel === "web" ? "here" : "by an agent, through MCP");
  return html`<ol class="timeline">
    ${reviews.map((r) => html`<li><time class="mono">${day(r.reviewedAt)}</time> ${statusBadge(r.verdict)} ${r.reviewedBy ?? "nobody signed in"}, ${where(r)}</li>`)}
  </ol>`;
}

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
  const access = await checkEntryAccess(user, id);
  if (access.status === "not_found") return c.html(layout("Not found", html`<p><a class="back" href="/">← Projects</a></p><div class="empty">Entry not found.</div>`), 404);
  if (access.status === "forbidden") return c.html(deniedPage(user), 403);
  try {
    await purgeEntries([id], user);
  } catch (e) {
    if (!(e instanceof NotAManagerError)) throw e;
    return c.html(
      layout("Not allowed", html`<p><a class="back" href="/entry/${id}">← Back to the entry</a></p><div class="empty">${e.message}</div>`, user),
      403,
    );
  }
  return c.redirect(access.project?.slug ? `/p/${access.project.slug}` : "/");
});

const NOT_ON_THE_TEAM = "Only the owner of this project, its members or an administrator judge its memos.";

function notOnTheTeam(entryId: string, user: WebEnv["Variables"]["user"]) {
  return layout("Not allowed", html`<p><a class="back" href="/entry/${entryId}">← Back to the entry</a></p><div class="empty">${NOT_ON_THE_TEAM}</div>`, user);
}

entriesRoutes.post("/entry/:id/validate", async (c) => {
  const id = c.req.param("id");
  // Reading the project is not enough: in a public one that is anyone signed in, and a verdict
  // decides what its agents are told first (ADR-0091).
  const access = await checkEntryAccess(c.get("user"), id);
  if (access.status === "not_found") return c.html(layout("Not found", html`<p><a class="back" href="/">← Projects</a></p><div class="empty">Entry not found.</div>`), 404);
  if (access.status === "forbidden") return c.html(deniedPage(c.get("user")), 403);
  if (!(await canReviewEntryProject(c.get("user"), access.project))) return c.html(notOnTheTeam(id, c.get("user")), 403);
  const form = await c.req.parseBody();
  const verdict = String(form.status);
  if (isReviewVerdict(verdict)) await validateEntry(id, verdict, { email: c.get("user")!.email, channel: "web" });
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
    const access = await checkProjectAccess(user, { name: project });
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
  const access = await checkEntryAccess(c.get("user"), id);
  if (access.status === "not_found")
    return c.html(layout("Not found", html`<p><a class="back" href="/">← Projects</a></p><div class="empty">Entry not found.</div>`), 404);
  if (access.status === "forbidden") return c.html(deniedPage(c.get("user")), 403);
  if (!(await canReviewEntryProject(c.get("user"), access.project))) return c.html(notOnTheTeam(id, c.get("user")), 403);
  const form = await c.req.parseBody();
  const title = String(form.title ?? "").trim();
  const content = String(form.content ?? "").trim();
  if (title && content) await updateEntryFields(id, { title, content });
  return c.redirect(`/entry/${id}`);
});

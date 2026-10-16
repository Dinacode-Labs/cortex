import { Hono } from "hono";
import { html } from "hono/html";
import { isReviewDecision, nextReview, NotAReviewerError, resolveReview, type Memo, type PendingReview } from "@cortex/core";
import { layout, type Html } from "../views/layout.js";
import { confidenceBadge, empty, panel, statusBadge, typeBadge } from "../views/components.js";
import { projectPage } from "../views/project-nav.js";
import { requireProjectPage, type ProjectPage } from "../middleware/access.js";
import type { WebEnv } from "../middleware/session.js";

/**
 * The Review section (ADR-0091): the older memos something newer was saved about, one at a time,
 * in the order the system chooses. Every decision lands on the next one, so a person only reads
 * and decides -- never picks what to look at, never navigates back.
 */
export const reviewRoutes = new Hono<WebEnv>();

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const notAReviewer = (page: ProjectPage, user: WebEnv["Variables"]["user"]) =>
  layout(
    page.project.name,
    projectPage(page, "review", empty("Only the owner of this project, its members or an administrator review its memos.")),
    user,
  );

function memoCard(memo: Memo, aside: Html | string = ""): Html {
  return html`<div>
    <div class="card-head">
      ${typeBadge(memo.type)} ${statusBadge(memo.status)} ${confidenceBadge(memo.confidence)}
      <span class="sub">${memo.createdAt.toISOString().slice(0, 10)}${aside}</span>
    </div>
    <h3><a href="/entry/${memo.id}">${memo.title}</a></h3>
    <div class="content-block">${memo.content}</div>
  </div>`;
}

function decisionForm(action: string, memoId: string, decision: string, label: string, style: string): Html {
  return html`<form method="post" action="${action}">
    <input type="hidden" name="memo" value="${memoId}">
    <input type="hidden" name="decision" value="${decision}">
    <button class="${style}" type="submit">${label}</button>
  </form>`;
}

function reviewScreen(page: ProjectPage, review: PendingReview): Html {
  const action = `/p/${page.project.slug}/review`;
  const { memo, newer } = review;
  const alike = (similarity: number) => ` · ${Math.round(similarity * 100)}% alike`;
  return html`
    ${panel("Does this still hold?", memoCard(memo), {
      help: "Something newer was saved about the same thing. The newer one is taken as true; the question is this one.",
    })}
    ${panel(
      newer.length === 1 ? "What came in since" : `What came in since (${newer.length})`,
      html`<div class="stack">${newer.map((n) => memoCard(n.memo, alike(n.similarity)))}</div>`,
    )}
    ${panel(
      "Your call",
      html`<div class="row">
          ${decisionForm(action, memo.id, "keep", "It still holds", "secondary")}
          ${decisionForm(action, memo.id, "discard", "Discard it: no longer true", "danger")}
          ${decisionForm(action, memo.id, "skip", "Skip for now", "quiet")}
        </div>
        <details style="margin-top:16px">
          <summary>Rewrite it</summary>
          <form method="post" action="${action}" style="margin-top:12px">
            <input type="hidden" name="memo" value="${memo.id}">
            <input type="hidden" name="decision" value="modify">
            <textarea name="content" rows="10" required>${memo.content}</textarea>
            <div class="row" style="margin-top:12px"><button type="submit">Save and go to the next</button></div>
          </form>
        </details>`,
      { help: "Whatever you choose, the next one comes up. Keeping or rewriting it marks it verified." },
    )}`;
}

reviewRoutes.get("/p/:slug/review", async (c) => {
  const user = c.get("user");
  const page = await requireProjectPage(c, c.req.param("slug"));
  if (page instanceof Response) return page;
  if (!page.reviewer) return c.html(notAReviewer(page, user), 403);

  const review = await nextReview(page.project);
  const body = review
    ? reviewScreen(page, review)
    : empty(
        "Nothing to review. When something new is saved about a memo already here, the older one comes up for you to judge.",
        html`<a class="button secondary" href="/p/${page.project.slug}">Back to the memory</a>`,
      );
  return c.html(layout(`Review · ${page.project.name}`, projectPage(page, "review", body), user));
});

reviewRoutes.post("/p/:slug/review", async (c) => {
  const user = c.get("user")!;
  const page = await requireProjectPage(c, c.req.param("slug"));
  if (page instanceof Response) return page;
  const next = `/p/${page.project.slug}/review`;

  const form = await c.req.parseBody();
  const memoId = String(form.memo ?? "");
  const decision = String(form.decision ?? "");
  if (!UUID.test(memoId) || !isReviewDecision(decision)) return c.redirect(next);
  try {
    await resolveReview(page.project, memoId, decision, user, typeof form.content === "string" ? form.content : undefined);
  } catch (e) {
    if (e instanceof NotAReviewerError) return c.html(notAReviewer(page, user), 403);
    throw e;
  }
  return c.redirect(next);
});

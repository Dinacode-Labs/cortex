import { Hono } from "hono";
import { html } from "hono/html";
import { isReviewDecision, nextReview, NotAReviewerError, resolveReview, type Memo, type PendingReview, type ReviewDecision } from "@cortex/core";
import { layout, type Html } from "../views/layout.js";
import { badge, confidenceMeter, empty, panel, statusBadge, typeTag } from "../views/components.js";
import { projectPage } from "../views/project-nav.js";
import { requireProjectPage, type ProjectPage } from "../middleware/access.js";
import type { WebEnv } from "../middleware/session.js";
import { ASSET_VERSION } from "../version.js";

/**
 * The Review section (ADR-0091): the older memos something newer was saved about, one at a time,
 * in the order the system chooses. Every decision lands on the next one, so a person only reads
 * and decides -- never picks what to look at, never navigates back.
 */
export const reviewRoutes = new Hono<WebEnv>();

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const DONE: Record<ReviewDecision, string> = {
  keep: "Kept, and marked verified.",
  discard: "Discarded: it no longer counts as true.",
  modify: "Rewritten, and marked verified.",
  skip: "Skipped: it waits behind the rest.",
};

const notAReviewer = (page: ProjectPage, user: WebEnv["Variables"]["user"]) =>
  layout(
    page.project.name,
    projectPage(page, "review", empty("Only the owner of this project, its members or an administrator review its memos.")),
    user,
  );

function memoPanel(memo: Memo, opts: { question?: boolean; similarity?: number } = {}): Html {
  const day = memo.createdAt.toISOString().slice(0, 10);
  return html`<article class="memo-panel ${opts.question ? "question" : ""}">
    <div class="memo-meta">
      ${opts.similarity !== undefined ? badge(`${Math.round(opts.similarity * 100)}% alike`, "accent") : ""}
      ${typeTag(memo.type)}
      <span class="memo-source">${memo.sourceReference ?? memo.sourceType}</span>
      <time class="memo-date" datetime="${memo.createdAt.toISOString()}">${day}</time>
    </div>
    <h3 class="memo-title"><a href="/entry/${memo.id}">${memo.title}</a></h3>
    <p class="memo-text">${memo.content}</p>
    ${opts.question ? html`<div class="memo-foot">${statusBadge(memo.status)} ${confidenceMeter(memo.confidence)}</div>` : ""}
  </article>`;
}

function decisionForm(action: string, memoId: string, decision: ReviewDecision, label: string, style: string, key: string): Html {
  return html`<form method="post" action="${action}" data-decision="${decision}">
    <input type="hidden" name="memo" value="${memoId}">
    <input type="hidden" name="decision" value="${decision}">
    <button class="${style}" type="submit">${label}<kbd class="key-hint" data-key-hint hidden>${key}</kbd></button>
  </form>`;
}

function reviewScreen(page: ProjectPage, review: PendingReview): Html {
  const action = `/p/${page.project.slug}/review`;
  const { memo, newer } = review;
  return html`
    <p class="sub lead">
      Something newer was saved about the same thing. The newer one is taken as true; the question is whether the
      older one still holds. ${page.pendingReviews} ${page.pendingReviews === 1 ? "memo waits" : "memos wait"} in all.
    </p>
    <div class="compare">
      <section>
        <h2 class="compare-label">Older · the question</h2>
        ${memoPanel(memo, { question: true })}
      </section>
      <section>
        <h2 class="compare-label">${newer.length === 1 ? "What came in since" : `What came in since (${newer.length})`} · taken as true</h2>
        <div class="stack">${newer.map((n) => memoPanel(n.memo, { similarity: n.similarity }))}</div>
      </section>
    </div>
    ${panel(
      "Does this still hold?",
      html`<div class="row">
          ${decisionForm(action, memo.id, "keep", "It still holds", "secondary", "K")}
          ${decisionForm(action, memo.id, "discard", "Discard it: no longer true", "danger", "D")}
          ${decisionForm(action, memo.id, "skip", "Skip for now", "quiet", "S")}
        </div>
        <details class="rewrite" data-rewrite>
          <summary>Partly true? Rewrite it <kbd class="key-hint" data-key-hint hidden>R</kbd></summary>
          <form method="post" action="${action}">
            <input type="hidden" name="memo" value="${memo.id}">
            <input type="hidden" name="decision" value="modify">
            <textarea name="content" rows="10" required aria-label="The older memo, rewritten">${memo.content}</textarea>
            <div class="row"><button type="submit">Save and go to the next</button></div>
          </form>
        </details>`,
      { help: "Whatever you choose, the next one comes up. Keeping or rewriting it marks it verified." },
    )}
    <script src="/review.js?v=${ASSET_VERSION}" defer></script>`;
}

reviewRoutes.get("/p/:slug/review", async (c) => {
  const user = c.get("user");
  const page = await requireProjectPage(c, c.req.param("slug"));
  if (page instanceof Response) return page;
  if (!page.reviewer) return c.html(notAReviewer(page, user), 403);

  const done = c.req.query("done") ?? "";
  const flash = isReviewDecision(done) ? html`<p class="flash" role="status">${DONE[done]}</p>` : html``;
  const review = await nextReview(page.project);
  const body = review
    ? reviewScreen(page, review)
    : empty(
        "Nothing to review. When something new is saved about a memo already here, the older one comes up for you to judge.",
        html`<a class="button secondary" href="/p/${page.project.slug}">Back to the memory</a>`,
      );
  return c.html(layout(`Review · ${page.project.name}`, projectPage(page, "review", html`${flash}${body}`), user));
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
  return c.redirect(`${next}?done=${decision}`);
});

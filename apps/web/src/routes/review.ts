import { Hono } from "hono";
import { html } from "hono/html";
import {
  isReviewDecision,
  nextReview,
  nextUnchecked,
  NotAReviewerError,
  resolveReview,
  resolveUnchecked,
  type Memo,
  type PendingReview,
  type ReviewDecision,
  type UncheckedMemo,
} from "@cortex/core";
import { layout, type Html } from "../views/layout.js";
import { badge, confidenceMeter, empty, panel, segmented, statusBadge, typeTag } from "../views/components.js";
import { projectPage } from "../views/project-nav.js";
import { requireProjectPage, type ProjectPage } from "../middleware/access.js";
import type { WebEnv } from "../middleware/session.js";
import { ASSET_VERSION } from "../version.js";

/**
 * The Review section, in two lanes: the older memos something newer was saved about (ADR-0091),
 * and the memos nobody has checked yet (ADR-0093). One memo at a time, in the order the system
 * chooses. Every decision lands on the next one in the same lane, so a person only reads and
 * decides -- never picks what to look at, never navigates back.
 */
export const reviewRoutes = new Hono<WebEnv>();

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

type Lane = "older" | "new";

const isLane = (value: string): value is Lane => value === "older" || value === "new";

const DONE: Record<Lane, Record<ReviewDecision, string>> = {
  older: {
    keep: "Kept, and marked verified.",
    discard: "Discarded: it no longer counts as true.",
    modify: "Rewritten, and marked verified.",
    skip: "Skipped: it waits behind the rest.",
  },
  new: {
    keep: "Confirmed, and marked verified.",
    discard: "Rejected: agents are no longer told it.",
    modify: "Rewritten, and marked verified.",
    skip: "Skipped: it waits behind the rest.",
  },
};

interface DecisionWording {
  question: string;
  keep: string;
  discard: string;
  rewrite: string;
  rewritten: string;
}

const WORDING: Record<Lane, DecisionWording> = {
  older: {
    question: "Does this still hold?",
    keep: "It still holds",
    discard: "Discard it: no longer true",
    rewrite: "Partly true? Rewrite it",
    rewritten: "The older memo, rewritten",
  },
  new: {
    question: "Is this right?",
    keep: "It is right",
    discard: "Reject it: it is wrong",
    rewrite: "Partly right? Rewrite it",
    rewritten: "The new memo, rewritten",
  },
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

function decisionForm(action: string, lane: Lane, memoId: string, decision: ReviewDecision, label: string, style: string, key: string): Html {
  return html`<form method="post" action="${action}" data-decision="${decision}">
    <input type="hidden" name="lane" value="${lane}">
    <input type="hidden" name="memo" value="${memoId}">
    <input type="hidden" name="decision" value="${decision}">
    <button class="${style}" type="submit">${label}<kbd class="key-hint" data-key-hint hidden>${key}</kbd></button>
  </form>`;
}

function decisionPanel(page: ProjectPage, lane: Lane, memo: Memo): Html {
  const action = `/p/${page.project.slug}/review`;
  const words = WORDING[lane];
  return html`${panel(
    words.question,
    html`<div class="row">
        ${decisionForm(action, lane, memo.id, "keep", words.keep, "secondary", "K")}
        ${decisionForm(action, lane, memo.id, "discard", words.discard, "danger", "D")}
        ${decisionForm(action, lane, memo.id, "skip", "Skip for now", "quiet", "S")}
      </div>
      <details class="rewrite" data-rewrite>
        <summary>${words.rewrite} <kbd class="key-hint" data-key-hint hidden>R</kbd></summary>
        <form method="post" action="${action}">
          <input type="hidden" name="lane" value="${lane}">
          <input type="hidden" name="memo" value="${memo.id}">
          <input type="hidden" name="decision" value="modify">
          <textarea name="content" rows="10" required aria-label="${words.rewritten}">${memo.content}</textarea>
          <div class="row"><button type="submit">Save and go to the next</button></div>
        </form>
      </details>`,
    { help: "Whatever you choose, the next one comes up. Keeping or rewriting it marks it verified." },
  )}
    <script src="/review.js?v=${ASSET_VERSION}" defer></script>`;
}

const waitingIn = (n: number) => `${n} ${n === 1 ? "memo waits" : "memos wait"} in this lane.`;

function olderScreen(page: ProjectPage, review: PendingReview): Html {
  const { memo, newer } = review;
  return html`
    <p class="sub lead">
      Something newer was saved about the same thing. The newer one is taken as true; the question is whether the
      older one still holds. ${waitingIn(page.pendingReviews)}
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
    ${decisionPanel(page, "older", memo)}`;
}

function uncheckedScreen(page: ProjectPage, unchecked: UncheckedMemo): Html {
  const { memo, touches } = unchecked;
  return html`
    <p class="sub lead">
      Nobody has checked this memo yet. Agents take it as true meanwhile; the question is whether it is right.
      ${waitingIn(page.uncheckedMemos)}
    </p>
    <div class="compare">
      <section>
        <h2 class="compare-label">New · the question</h2>
        ${memoPanel(memo, { question: true })}
      </section>
      ${touches.length
        ? html`<section>
            <h2 class="compare-label">${touches.length === 1 ? "The older memo it touches" : `The older memos it touches (${touches.length})`} · waiting in the other lane</h2>
            <div class="stack">${touches.map((t) => memoPanel(t.memo, { similarity: t.similarity }))}</div>
          </section>`
        : ""}
    </div>
    ${decisionPanel(page, "new", memo)}`;
}

function laneNav(page: ProjectPage, lane: Lane): Html {
  const base = `/p/${page.project.slug}/review`;
  return html`<div class="list-controls">${segmented("Review lanes", [
    { label: "Touched by something newer", href: `${base}?lane=older`, on: lane === "older", count: page.pendingReviews },
    { label: "Not checked yet", href: `${base}?lane=new`, on: lane === "new", count: page.uncheckedMemos },
  ])}</div>`;
}

/** An empty lane points at the other one when something waits there: an empty screen is a dead end. */
function emptyLane(page: ProjectPage, lane: Lane): Html {
  const base = `/p/${page.project.slug}/review`;
  const other =
    lane === "older"
      ? { waiting: page.uncheckedMemos, href: `${base}?lane=new`, label: "Check the new ones" }
      : { waiting: page.pendingReviews, href: `${base}?lane=older`, label: "Review the older ones" };
  const action =
    other.waiting > 0
      ? html`<a class="button secondary" href="${other.href}">${other.label}</a>`
      : html`<a class="button secondary" href="/p/${page.project.slug}">Back to the memory</a>`;
  const text =
    lane === "older"
      ? "Nothing to review. When something new is saved about a memo already here, the older one comes up for you to judge."
      : "Nothing new to check. Every memo saved waits here until somebody on the team says whether it is right.";
  return empty(text, action);
}

/** Without a lane asked for, the first one with something in it. */
function laneShown(asked: string | undefined, page: ProjectPage): Lane {
  if (asked && isLane(asked)) return asked;
  return page.pendingReviews === 0 && page.uncheckedMemos > 0 ? "new" : "older";
}

reviewRoutes.get("/p/:slug/review", async (c) => {
  const user = c.get("user");
  const page = await requireProjectPage(c, c.req.param("slug"));
  if (page instanceof Response) return page;
  if (!page.reviewer) return c.html(notAReviewer(page, user), 403);

  const lane = laneShown(c.req.query("lane"), page);
  const done = c.req.query("done") ?? "";
  const flash = isReviewDecision(done) ? html`<p class="flash" role="status">${DONE[lane][done]}</p>` : html``;
  let screen: Html;
  if (lane === "older") {
    const review = await nextReview(page.project);
    screen = review ? olderScreen(page, review) : emptyLane(page, lane);
  } else {
    const unchecked = await nextUnchecked(page.project);
    screen = unchecked ? uncheckedScreen(page, unchecked) : emptyLane(page, lane);
  }
  return c.html(layout(`Review · ${page.project.name}`, projectPage(page, "review", html`${flash}${laneNav(page, lane)}${screen}`), user));
});

reviewRoutes.post("/p/:slug/review", async (c) => {
  const user = c.get("user")!;
  const page = await requireProjectPage(c, c.req.param("slug"));
  if (page instanceof Response) return page;
  const next = `/p/${page.project.slug}/review`;

  const form = await c.req.parseBody();
  // A form rendered before the lanes existed carries none, and it could only be the older lane's.
  const askedLane = String(form.lane ?? "");
  const lane: Lane = isLane(askedLane) ? askedLane : "older";
  const memoId = String(form.memo ?? "");
  const decision = String(form.decision ?? "");
  if (!UUID.test(memoId) || !isReviewDecision(decision)) return c.redirect(`${next}?lane=${lane}`);
  const resolve = lane === "older" ? resolveReview : resolveUnchecked;
  try {
    await resolve(page.project, memoId, decision, user, typeof form.content === "string" ? form.content : undefined);
  } catch (e) {
    if (e instanceof NotAReviewerError) return c.html(notAReviewer(page, user), 403);
    throw e;
  }
  return c.redirect(`${next}?lane=${lane}&done=${decision}`);
});

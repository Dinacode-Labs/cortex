import { Hono } from "hono";
import { html } from "hono/html";
import {
  isReviewDecision,
  isReviewLane,
  mergeInReview,
  nextReview,
  nextUnchecked,
  NotAReviewerError,
  preparedMerge,
  proposeMerge,
  resolveReview,
  resolveUnchecked,
  suggestionFor,
  type Finding,
  type GroupRelation,
  type MergeDraft,
  type MergeProposal,
  type Memo,
  type MemoSuggestion,
  type PendingReview,
  type ReviewDecision,
  type ReviewLane,
  type UncheckedMemo,
} from "@cortex/core";
import { contextEntryType } from "@cortex/shared";
import { layout, type Html } from "../views/layout.js";
import { badge, confidenceMeter, empty, panel, segmented, statusBadge, typeTag, type Tone } from "../views/components.js";
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

// A form rendered before the lanes existed carries none, and it could only be the older lane's.
const laneOf = (value: unknown): ReviewLane => {
  const asked = String(value ?? "");
  return isReviewLane(asked) ? asked : "older";
};

type Outcome = ReviewDecision | "merge";

const isOutcome = (value: string): value is Outcome => value === "merge" || isReviewDecision(value);

const MERGED = "Merged into one memo, marked verified. The memos it replaces no longer count.";

const DONE: Record<ReviewLane, Record<Outcome, string>> = {
  older: {
    keep: "Kept, and marked verified.",
    discard: "Discarded: it no longer counts as true.",
    modify: "Rewritten, and marked verified.",
    merge: MERGED,
    skip: "Skipped: it waits behind the rest.",
  },
  new: {
    keep: "Confirmed, and marked verified.",
    discard: "Rejected: agents are no longer told it.",
    modify: "Rewritten, and marked verified.",
    merge: MERGED,
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

const WORDING: Record<ReviewLane, DecisionWording> = {
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

const MERGE_FORM = "merge-form";

const RELATION_SHOWN: Record<GroupRelation, { label: string; tone: Tone }> = {
  duplicate: { label: "Says the same", tone: "warn" },
  overlap: { label: "Part of the same", tone: "neutral" },
  contradiction: { label: "Disagrees", tone: "danger" },
};

/** What the nightly pass's agent said of it (ADR-0098): a suggestion beside the memo, never a verdict. */
function findingLine(finding: Finding): Html {
  const shown = RELATION_SHOWN[finding.relation];
  return html`<p class="memo-finding">${badge(shown.label, shown.tone)} <span class="sub">The nightly pass${finding.reason ? html`: ${finding.reason}` : ""}</span></p>`;
}

/** The checkbox sits in the memo's panel, outside the merge form, so it joins that form through `form=`. */
function memoPanel(memo: Memo, opts: { question?: boolean; similarity?: number; pickedFor?: string; finding?: Finding | null } = {}): Html {
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
    ${opts.finding ? findingLine(opts.finding) : ""}
    ${opts.question ? html`<div class="memo-foot">${statusBadge(memo.status)} ${confidenceMeter(memo.confidence)}</div>` : ""}
    ${opts.pickedFor
      ? html`<div class="memo-foot">
          <label class="check"><input type="checkbox" form="${opts.pickedFor}" name="with" value="${memo.id}" checked> Merge this one in</label>
        </div>`
      : ""}
  </article>`;
}

function decisionForm(action: string, lane: ReviewLane, memoId: string, decision: ReviewDecision, label: string, style: string, key: string): Html {
  return html`<form method="post" action="${action}" data-decision="${decision}">
    <input type="hidden" name="lane" value="${lane}">
    <input type="hidden" name="memo" value="${memoId}">
    <input type="hidden" name="decision" value="${decision}">
    <button class="${style}" type="submit">${label}<kbd class="key-hint" data-key-hint hidden>${key}</kbd></button>
  </form>`;
}

/** A GET: it only asks for a draft, and nothing changes until the merged memo is saved. */
function mergeForm(action: string, lane: ReviewLane, memoId: string, others: Memo[]): Html {
  return html`<form method="get" action="${action}/merge" id="${MERGE_FORM}" data-decision="merge">
    <input type="hidden" name="lane" value="${lane}">
    <input type="hidden" name="memo" value="${memoId}">
    ${others.length === 1 ? html`<input type="hidden" name="with" value="${others[0]!.id}">` : ""}
    <button class="secondary" type="submit">Merge them into one<kbd class="key-hint" data-key-hint hidden>M</kbd></button>
  </form>`;
}

function decisionPanel(page: ProjectPage, lane: ReviewLane, memo: Memo, others: Memo[], suggestion: MemoSuggestion | null = null): Html {
  const action = `/p/${page.project.slug}/review`;
  const words = WORDING[lane];
  const draft = suggestion?.kind === "rewrite" ? suggestion : memo;
  return html`${panel(
    words.question,
    html`<div class="row">
        ${decisionForm(action, lane, memo.id, "keep", words.keep, "secondary", "K")}
        ${decisionForm(action, lane, memo.id, "discard", words.discard, "danger", "D")}
        ${others.length ? mergeForm(action, lane, memo.id, others) : ""}
        ${decisionForm(action, lane, memo.id, "skip", "Skip for now", "quiet", "S")}
      </div>
      <details class="rewrite" data-rewrite>
        <summary>${suggestion?.kind === "rewrite" ? "Rewrite it, from the agent's version" : words.rewrite} <kbd class="key-hint" data-key-hint hidden>R</kbd></summary>
        <form method="post" action="${action}">
          <input type="hidden" name="lane" value="${lane}">
          <input type="hidden" name="memo" value="${memo.id}">
          <input type="hidden" name="decision" value="modify">
          <input type="text" name="title" value="${draft.title}" required aria-label="Title" class="wide">
          <textarea name="content" rows="10" required aria-label="${words.rewritten}">${draft.content}</textarea>
          <div class="row"><button type="submit">Save and go to the next</button></div>
        </form>
      </details>`,
    { help: "Whatever you choose, the next one comes up. Keeping or rewriting it marks it verified; merging replaces them with one memo, verified." },
  )}
    <script src="/review.js?v=${ASSET_VERSION}" defer></script>`;
}

const pickable = (others: unknown[]) => (others.length > 1 ? MERGE_FORM : undefined);

/** Drafted ahead by the worker (ADR-0096); without one the screen shows nothing rather than wait on a model. */
function preparedPanel(prepared: MergeDraft | null): Html {
  if (!prepared) return html``;
  return html`<section class="prepared-merge">
    <h2 class="compare-label">Merged, the agent would make it this · nothing changes unless you merge them</h2>
    <article class="memo-panel">
      <h3 class="memo-title">${prepared.title}</h3>
      <p class="memo-text">${prepared.content}</p>
    </article>
  </section>`;
}

/** Written by the nightly pass (ADR-0099); the screen shows what is there and never asks a model. */
function suggestionPanel(suggestion: MemoSuggestion | null): Html {
  if (!suggestion) return html``;
  if (suggestion.kind === "reject") {
    return html`<p class="memo-finding">${badge("Suggests rejecting it", "danger")} <span class="sub">The editing agent: ${suggestion.reason}</span></p>`;
  }
  return html`<section class="prepared-merge">
    <h2 class="compare-label">Rewritten, the editing agent would make it this · nothing changes unless you save it</h2>
    <article class="memo-panel">
      ${suggestion.reason ? html`<p class="memo-finding"><span class="sub">${suggestion.reason}</span></p>` : ""}
      <h3 class="memo-title">${suggestion.title}</h3>
      <p class="memo-text">${suggestion.content}</p>
    </article>
  </section>`;
}

const waitingIn = (n: number) => `${n} ${n === 1 ? "memo waits" : "memos wait"} in this lane.`;

function olderScreen(page: ProjectPage, review: PendingReview, prepared: MergeDraft | null): Html {
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
        <div class="stack">${newer.map((n) => memoPanel(n.memo, { similarity: n.similarity, pickedFor: pickable(newer), finding: n.finding }))}</div>
      </section>
    </div>
    ${preparedPanel(prepared)}
    ${decisionPanel(page, "older", memo, newer.map((n) => n.memo))}`;
}

function uncheckedScreen(page: ProjectPage, unchecked: UncheckedMemo, prepared: MergeDraft | null, suggestion: MemoSuggestion | null): Html {
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
            <div class="stack">${touches.map((t) => memoPanel(t.memo, { similarity: t.similarity, pickedFor: pickable(touches) }))}</div>
          </section>`
        : ""}
    </div>
    ${preparedPanel(prepared)}
    ${suggestionPanel(suggestion)}
    ${decisionPanel(page, "new", memo, touches.map((t) => t.memo), suggestion)}`;
}

function mergeScreen(page: ProjectPage, lane: ReviewLane, memoId: string, proposal: MergeProposal): Html {
  const action = `/p/${page.project.slug}/review`;
  const lead = proposal.drafted
    ? "The consolidation agent drafted one memo from these. Correct whatever it got wrong: saving replaces them with it, marked verified."
    : "No model drafted this merge, so their texts are put together, the newest first, for you to merge. Saving replaces them with it, marked verified.";
  return html`
    <p class="sub lead">${lead}</p>
    <div class="compare">
      <section>
        <h2 class="compare-label">What it replaces (${proposal.memos.length}) · oldest first</h2>
        <div class="stack">${proposal.memos.map((m) => memoPanel(m, { question: m.id === memoId }))}</div>
      </section>
      <section>
        <h2 class="compare-label">The merged memo · yours to edit</h2>
        <form method="post" action="${action}/merge" class="memo-panel merge-form" aria-label="The merged memo">
          <input type="hidden" name="lane" value="${lane}">
          <input type="hidden" name="memo" value="${memoId}">
          ${proposal.memos.filter((m) => m.id !== memoId).map((m) => html`<input type="hidden" name="with" value="${m.id}">`)}
          <input type="text" name="title" value="${proposal.title}" required aria-label="Title" class="wide">
          <textarea name="content" rows="14" required aria-label="Text">${proposal.content}</textarea>
          <div class="row">
            <select name="type" aria-label="Type">
              ${contextEntryType.options.map((t) => html`<option value="${t}" ${t === proposal.type ? "selected" : ""}>${t}</option>`)}
            </select>
            <button type="submit">Save it and go to the next</button>
            <a class="button quiet" href="${action}?lane=${lane}">Back</a>
          </div>
        </form>
      </section>
    </div>`;
}

function laneNav(page: ProjectPage, lane: ReviewLane): Html {
  const base = `/p/${page.project.slug}/review`;
  return html`<div class="list-controls">${segmented("Review lanes", [
    { label: "Touched by something newer", href: `${base}?lane=older`, on: lane === "older", count: page.pendingReviews },
    { label: "Not checked yet", href: `${base}?lane=new`, on: lane === "new", count: page.uncheckedMemos },
  ])}</div>`;
}

/** An empty lane points at the other one when something waits there: an empty screen is a dead end. */
function emptyLane(page: ProjectPage, lane: ReviewLane): Html {
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
function laneShown(asked: string | undefined, page: ProjectPage): ReviewLane {
  if (asked && isReviewLane(asked)) return asked;
  return page.pendingReviews === 0 && page.uncheckedMemos > 0 ? "new" : "older";
}

reviewRoutes.get("/p/:slug/review", async (c) => {
  const user = c.get("user");
  const page = await requireProjectPage(c, c.req.param("slug"));
  if (page instanceof Response) return page;
  if (!page.reviewer) return c.html(notAReviewer(page, user), 403);

  const lane = laneShown(c.req.query("lane"), page);
  const done = c.req.query("done") ?? "";
  const flash = isOutcome(done) ? html`<p class="flash" role="status">${DONE[lane][done]}</p>` : html``;
  let screen: Html;
  if (lane === "older") {
    const review = await nextReview(page.project);
    screen = review ? olderScreen(page, review, await preparedMerge([review.memo, ...review.newer.map((n) => n.memo)])) : emptyLane(page, lane);
  } else {
    const unchecked = await nextUnchecked(page.project);
    const touched = unchecked?.touches.map((t) => t.memo) ?? [];
    const prepared = unchecked && touched.length > 0 ? await preparedMerge([unchecked.memo, ...touched]) : null;
    screen = unchecked ? uncheckedScreen(page, unchecked, prepared, await suggestionFor(unchecked.memo)) : emptyLane(page, lane);
  }
  return c.html(layout(`Review · ${page.project.name}`, projectPage(page, "review", html`${flash}${laneNav(page, lane)}${screen}`), user));
});

reviewRoutes.post("/p/:slug/review", async (c) => {
  const user = c.get("user")!;
  const page = await requireProjectPage(c, c.req.param("slug"));
  if (page instanceof Response) return page;
  const next = `/p/${page.project.slug}/review`;

  const form = await c.req.parseBody();
  const lane = laneOf(form.lane);
  const memoId = String(form.memo ?? "");
  const decision = String(form.decision ?? "");
  if (!UUID.test(memoId) || !isReviewDecision(decision)) return c.redirect(`${next}?lane=${lane}`);
  const resolve = lane === "older" ? resolveReview : resolveUnchecked;
  try {
    const text = (field: unknown) => (typeof field === "string" ? field : undefined);
    await resolve(page.project, memoId, decision, user, text(form.content), text(form.title));
  } catch (e) {
    if (e instanceof NotAReviewerError) return c.html(notAReviewer(page, user), 403);
    throw e;
  }
  return c.redirect(`${next}?lane=${lane}&done=${decision}`);
});

/** A merge that no longer applies -- the memo was decided meanwhile, nothing left to merge it with -- goes back to the lane. */
reviewRoutes.get("/p/:slug/review/merge", async (c) => {
  const user = c.get("user");
  const page = await requireProjectPage(c, c.req.param("slug"));
  if (page instanceof Response) return page;
  if (!page.reviewer || !user) return c.html(notAReviewer(page, user), 403);

  const lane = laneOf(c.req.query("lane"));
  const back = `/p/${page.project.slug}/review?lane=${lane}`;
  const memoId = c.req.query("memo") ?? "";
  const withIds = (c.req.queries("with") ?? []).filter((id) => UUID.test(id));
  if (!UUID.test(memoId)) return c.redirect(back);
  const proposal = await proposeMerge(page.project, lane, memoId, withIds, user);
  if (!proposal) return c.redirect(back);
  return c.html(layout(`Merge · ${page.project.name}`, projectPage(page, "review", mergeScreen(page, lane, memoId, proposal)), user));
});

reviewRoutes.post("/p/:slug/review/merge", async (c) => {
  const user = c.get("user")!;
  const page = await requireProjectPage(c, c.req.param("slug"));
  if (page instanceof Response) return page;

  const form = await c.req.parseBody({ all: true });
  const lane = laneOf(form.lane);
  const next = `/p/${page.project.slug}/review?lane=${lane}`;
  const memoId = String(form.memo ?? "");
  const withIds = [form.with ?? []].flat().map(String).filter((id) => UUID.test(id));
  const type = contextEntryType.safeParse(form.type);
  if (!UUID.test(memoId) || !type.success || typeof form.content !== "string") return c.redirect(next);
  const draft = { title: String(form.title ?? ""), content: form.content, type: type.data };
  try {
    const merged = await mergeInReview(page.project, lane, memoId, withIds, draft, user);
    return c.redirect(merged ? `${next}&done=merge` : next);
  } catch (e) {
    if (e instanceof NotAReviewerError) return c.html(notAReviewer(page, user), 403);
    throw e;
  }
});

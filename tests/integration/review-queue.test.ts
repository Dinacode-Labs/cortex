import { describe, it, expect, beforeAll } from "vitest";
import { getSql } from "@cortex/database";
import {
  addProjectMember,
  captureBatch,
  createProject,
  getEntryDetail,
  nextReview,
  pendingReviewCount,
  requestOtp,
  saveContext,
  validateEntry,
  verifyOtp,
  type ProjectRef,
} from "@cortex/core";
import { createApp as createWebApp } from "../../apps/web/src/app.js";

const RID = Math.random().toString(36).slice(2, 8);
const OWNER = `queue-owner-${RID}@example.com`;
const MEMBER = `queue-member-${RID}@example.com`;
const OUTSIDER = `queue-outsider-${RID}@example.com`;

// Each pair scores ~0.86 with the tests' local embeddings -- the same thing, worded differently --
// and under 0.1 against the other pair.
const BACKOFF = [
  "The retry backoff is exponential, capped at 60 seconds, with jitter.",
  "The retry backoff is exponential, capped at 60 seconds, with random jitter to avoid synchronisation.",
] as const;
const DEPLOYS = [
  "Deploys go out on Tuesdays after the release review.",
  "Deploys go out on Tuesdays after the release review, and never on a Friday.",
] as const;

async function cookieFor(email: string): Promise<string> {
  let cap = "";
  const orig = console.log;
  console.log = ((...a: unknown[]) => {
    cap += a.join(" ") + "\n";
  }) as typeof console.log;
  try {
    await requestOtp(email);
  } finally {
    console.log = orig;
  }
  const code = cap.split("\n").find((l) => l.includes(email))?.match(/(\d{6})/)?.[1];
  if (!code) throw new Error(`the OTP for ${email} was not captured`);
  return `cortex_session=${(await verifyOtp(email, code)).token}`;
}

let ownerCookie: string;
let memberCookie: string;
let outsiderCookie: string;

beforeAll(async () => {
  ownerCookie = await cookieFor(OWNER);
  memberCookie = await cookieFor(MEMBER);
  outsiderCookie = await cookieFor(OUTSIDER);
}, 120_000);

const newProject = (label: string): Promise<ProjectRef> => createProject(`Queue ${label} ${RID}`, { ownerEmail: OWNER });

async function save(project: ProjectRef, content: string): Promise<string> {
  const { entry } = await saveContext({ content, project: project.name, type: "decision", createdBy: OWNER }, { useClassifier: false });
  return entry.id;
}

/** An older memo and a newer one about the same thing: the older comes up for review. */
async function staleAndFresh(project: ProjectRef, [older, newer]: readonly [string, string] = BACKOFF): Promise<{ stale: string; fresh: string }> {
  const stale = await save(project, older);
  const fresh = await save(project, newer);
  return { stale, fresh };
}

const page = (path: string, cookie = ownerCookie) => createWebApp().request(path, { headers: { cookie } });

function decide(project: ProjectRef, memo: string, decision: string, cookie = ownerCookie, content?: string) {
  const fields: Record<string, string> = { memo, decision, ...(content !== undefined ? { content } : {}) };
  return createWebApp().request(`/p/${project.slug}/review`, {
    method: "POST",
    headers: { cookie, "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams(fields).toString(),
  });
}

/*
 * A new memo was only ever compared with the single nearest one, from 0.82 up, and what it said
 * about older memos was a warning shown once and lost: an older memo it contradicted stayed in
 * the pack, unquestioned, for good (ADR-0091).
 */
describe("saving a memo about something already remembered", () => {
  it("puts the older memo up for review, with the newer one beside it, and leaves unrelated ones alone", async () => {
    const project = await newProject("enqueue");
    const unrelated = await save(project, `The invoices are signed with the vendor key ${RID}.`);
    const { stale, fresh } = await staleAndFresh(project);

    const review = (await nextReview(project))!;
    expect(review.memo.id).toBe(stale);
    expect(review.newer.map((n) => n.memo.id)).toEqual([fresh]);
    expect(review.newer[0]!.similarity).toBeGreaterThanOrEqual(0.75);
    expect(await pendingReviewCount(project)).toBe(1);

    const queued = (await getSql()`SELECT memo_id FROM review_queue WHERE memo_id = ${unrelated}`) as unknown as unknown[];
    expect(queued).toEqual([]);
  });

  /* A connector ingesting a repository's documents would otherwise bury the queue on its first run. */
  it("bulk ingestion raises no reviews", async () => {
    const project = await newProject("bulk");
    await captureBatch(project.name, BACKOFF.map((content) => ({ content })), OWNER);
    expect(await pendingReviewCount(project)).toBe(0);
  });

  it("a memo discarded elsewhere drops out of the queue", async () => {
    const project = await newProject("dropout");
    const { stale } = await staleAndFresh(project);
    await validateEntry(stale, "obsolete", { email: OWNER, channel: "web" });
    expect(await nextReview(project)).toBeNull();
  });
});

describe("the Review section", () => {
  it("shows the older memo, what came in since, and the ways out", async () => {
    const project = await newProject("screen");
    await staleAndFresh(project);

    const html = await (await page(`/p/${project.slug}/review`)).text();
    expect(html).toContain("Does this still hold?");
    expect(html).toContain("random jitter to avoid synchronisation");
    for (const decision of ["keep", "discard", "skip", "modify"]) expect(html).toContain(`value="${decision}"`);
  });

  it("says when there is nothing to review", async () => {
    const project = await newProject("empty");
    expect(await (await page(`/p/${project.slug}/review`)).text()).toContain("Nothing to review.");
  });

  it("every decision lands on the next memo, never back on a list", async () => {
    const project = await newProject("next");
    const first = await staleAndFresh(project, BACKOFF);
    const second = await staleAndFresh(project, DEPLOYS);
    const head = (await nextReview(project))!.memo.id;
    const other = head === first.stale ? second.stale : first.stale;

    const res = await decide(project, head, "keep");
    expect(res.status).toBe(302);
    expect(res.headers.get("location")).toBe(`/p/${project.slug}/review?done=keep`);
    expect((await nextReview(project))!.memo.id).toBe(other);
    // The memo decided on is gone from view, so the next screen says what happened to it.
    expect(await (await page(res.headers.get("location")!)).text()).toContain("Kept, and marked verified.");
  });

  it("keeping it vouches for it: the memo is verified and leaves the queue", async () => {
    const project = await newProject("keep");
    const { stale } = await staleAndFresh(project);
    await decide(project, stale, "keep");

    const memo = (await getEntryDetail(stale))!.entry;
    expect([memo.status, memo.confidence]).toEqual(["validated", "verified"]);
    expect(await pendingReviewCount(project)).toBe(0);
  });

  it("discarding it says it held once and no longer does", async () => {
    const project = await newProject("discard");
    const { stale } = await staleAndFresh(project);
    await decide(project, stale, "discard");

    expect((await getEntryDetail(stale))!.entry.status).toBe("obsolete");
    expect(await pendingReviewCount(project)).toBe(0);
  });

  it("rewriting it replaces the text, scrubbed, and vouches for it", async () => {
    const project = await newProject("modify");
    const { stale } = await staleAndFresh(project);
    await decide(project, stale, "modify", ownerCookie, "The backoff is exponential up to 60 s. Token: sk-abcdefghijklmnopqrstuvwxyz123456");

    const memo = (await getEntryDetail(stale))!.entry;
    expect(memo.content).toContain("The backoff is exponential up to 60 s.");
    expect(memo.content).not.toContain("sk-abcdefghijklmnopqrstuvwxyz123456");
    expect(memo.confidence).toBe("verified");
    expect(await pendingReviewCount(project)).toBe(0);
  });

  it("skipping it sends it behind the others, without deciding anything", async () => {
    const project = await newProject("skip");
    await staleAndFresh(project, BACKOFF);
    await staleAndFresh(project, DEPLOYS);
    const head = (await nextReview(project))!.memo.id;

    await decide(project, head, "skip");

    expect((await nextReview(project))!.memo.id).not.toBe(head);
    expect((await getEntryDetail(head))!.entry.status).toBe("pending_validation");
    expect(await pendingReviewCount(project)).toBe(2);
  });

  it("one decision on a memo closes every review of it, however many newer memos raised one", async () => {
    const project = await newProject("grouped");
    const stale = await save(project, BACKOFF[0]);
    await save(project, BACKOFF[1]);
    await save(project, "The retry backoff is exponential, capped at 60 seconds, with jitter on every outbound call.");
    expect((await nextReview(project))!.newer).toHaveLength(2);

    await decide(project, stale, "keep");

    expect(await pendingReviewCount(project)).toBe(0);
  });

  it("a second click on a decided memo changes nothing", async () => {
    const project = await newProject("twice");
    const { stale } = await staleAndFresh(project);
    await decide(project, stale, "keep");
    await decide(project, stale, "discard");
    expect((await getEntryDetail(stale))!.entry.status).toBe("validated");
  });
});

/*
 * In a public project, reading is open to anyone signed in, and judging a memo used to need only
 * that: a passer-by could discard memos or make them verified (ADR-0091).
 */
describe("who reviews", () => {
  it("a member of the project does", async () => {
    const project = await newProject("member");
    await addProjectMember(project.slug!, MEMBER, { email: OWNER });
    const { stale } = await staleAndFresh(project);

    expect(await (await page(`/p/${project.slug}`, memberCookie)).text()).toContain(`/p/${project.slug}/review`);
    await decide(project, stale, "discard", memberCookie);
    expect((await getEntryDetail(stale))!.entry.status).toBe("obsolete");
  });

  it("someone who can only read it sees no Review tab, and their decisions are refused", async () => {
    const project = await newProject("outsider");
    const { stale } = await staleAndFresh(project);

    expect(await (await page(`/p/${project.slug}`, outsiderCookie)).text()).not.toContain(`/p/${project.slug}/review`);
    expect((await page(`/p/${project.slug}/review`, outsiderCookie)).status).toBe(403);
    expect((await decide(project, stale, "discard", outsiderCookie)).status).toBe(403);
    expect((await getEntryDetail(stale))!.entry.status).toBe("pending_validation");
  });

  it("nor can they validate or edit it from the memo's own page", async () => {
    const project = await newProject("entry-page");
    const id = await save(project, `Sessions expire after eight hours ${RID}.`);
    const post = (path: string, fields: Record<string, string>) =>
      createWebApp().request(path, {
        method: "POST",
        headers: { cookie: outsiderCookie, "content-type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams(fields).toString(),
      });

    expect((await post(`/entry/${id}/validate`, { status: "validated" })).status).toBe(403);
    expect((await post(`/entry/${id}/edit`, { title: "Hijacked", content: "Hijacked" })).status).toBe(403);
    const memo = (await getEntryDetail(id))!.entry;
    expect([memo.status, memo.title]).toEqual(["pending_validation", expect.not.stringContaining("Hijacked")]);
    expect(await (await page(`/entry/${id}`, outsiderCookie)).text()).not.toContain(`/entry/${id}?edit=1`);
  });
});

/*
 * ADR-0092: an entry's page used to leave its project, and nothing on it said something newer had
 * put it in question -- whoever read it had to find the Review queue on their own.
 */
describe("an older memo's own page", () => {
  it("is read inside its project and says it waits in Review, until somebody decides", async () => {
    const project = await newProject("entry-page");
    const { stale } = await staleAndFresh(project);

    const before = await (await page(`/entry/${stale}`)).text();
    expect(before).toContain('class="project-shell"');
    expect(before).toContain(`href="/p/${project.slug}/review">Compare them`);

    await decide(project, stale, "keep");
    expect(await (await page(`/entry/${stale}`)).text()).not.toContain("Compare them");
  });

  it("does not send somebody off the team to a queue they cannot open", async () => {
    const project = await createProject(`Queue entry-public ${RID}`, { ownerEmail: OWNER, visibility: "public" });
    const { stale } = await staleAndFresh(project);
    expect(await (await page(`/entry/${stale}`, outsiderCookie)).text()).not.toContain("Compare them");
  });
});

/*
 * ADR-0092: the verdicts waiting only showed inside each project's Review, so nobody knew to go and
 * look. The projects page says where they wait, to whoever may give them.
 */
describe("the projects page", () => {
  it("says how many verdicts wait, and in which project, to the team only", async () => {
    const project = await createProject(`Queue home ${RID}`, { ownerEmail: OWNER, visibility: "public" });
    await staleAndFresh(project);
    const home = (cookie: string) => page("/", cookie).then((r) => r.text());

    expect(await home(ownerCookie)).toMatch(new RegExp(`href="/p/${project.slug}/review">[^<]*<span class="button-count">1</span>`));
    expect(await home(outsiderCookie)).not.toContain(`/p/${project.slug}/review`);
  });
});

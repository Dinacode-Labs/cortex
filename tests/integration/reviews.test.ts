import { describe, it, expect, beforeAll } from "vitest";
import { getSql } from "@cortex/database";
import {
  createProject,
  getContextPack,
  getEntryDetail,
  purgeEntries,
  reconcileProject,
  requestOtp,
  saveContext,
  saveWithReconciliation,
  setReconciler,
  validateEntry,
  verifyOtp,
  type ProjectRef,
} from "@cortex/core";
import { createApp as createWebApp } from "../../apps/web/src/app.js";

const RID = Math.random().toString(36).slice(2, 8);
const OWNER = `review-owner-${RID}@example.com`;

async function otpOf(email: string): Promise<string> {
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
  return code;
}

let ownerCookie: string;

beforeAll(async () => {
  ownerCookie = `cortex_session=${(await verifyOtp(OWNER, await otpOf(OWNER))).token}`;
}, 120_000);

const newProject = (label: string): Promise<ProjectRef> => createProject(`Review ${label} ${RID}`, { ownerEmail: OWNER });

async function distilled(project: ProjectRef, content: string): Promise<string> {
  const { entry } = await saveContext(
    { content, project: project.name, type: "decision", confidence: "low", sourceType: "agent_session", sourceReference: `claude:${RID}` },
    { useClassifier: false, detectImprovements: false },
  );
  return entry.id;
}

function judgeOnTheWeb(id: string, verdict: string) {
  return createWebApp().request(`/entry/${id}/validate`, {
    method: "POST",
    headers: { cookie: ownerCookie, "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ status: verdict }).toString(),
  });
}

/*
 * "Yes, it holds" used to change only the status, and nothing recorded who said it: the pack,
 * which orders by confidence, never noticed, and a validation could not be traced (ADR-0090).
 */
describe("a person reviewing a memo in the web UI", () => {
  it("makes it verified and records who said so, and from where", async () => {
    const id = await distilled(await newProject("web"), `The webhook retries back off exponentially ${RID}.`);

    expect((await judgeOnTheWeb(id, "validated")).status).toBe(302);

    const detail = (await getEntryDetail(id))!;
    expect(detail.entry.status).toBe("validated");
    expect(detail.entry.confidence).toBe("verified");
    expect(detail.reviews).toEqual([{ verdict: "validated", channel: "web", reviewedBy: OWNER, reviewedAt: expect.any(Date) }]);
  });

  it("the entry page shows who reviewed it, and says so when nobody has", async () => {
    const project = await newProject("page");
    const reviewed = await distilled(project, `The cache is warmed at deploy time ${RID}.`);
    const untouched = await distilled(project, `The cron runs at minute seven ${RID}.`);
    await judgeOnTheWeb(reviewed, "validated");

    const page = (id: string) => createWebApp().request(`/entry/${id}`, { headers: { cookie: ownerCookie } }).then((r) => r.text());
    expect(await page(reviewed)).toContain(OWNER);
    expect(await page(untouched)).toContain("Nobody has reviewed it yet.");
  });

  /* The route used to cast whatever the form carried into a status: `superseded` included. */
  it("a forged verdict changes nothing and records nothing", async () => {
    const id = await distilled(await newProject("forged"), `The queue is drained before shutdown ${RID}.`);

    await judgeOnTheWeb(id, "superseded");

    const detail = (await getEntryDetail(id))!;
    expect(detail.entry.status).toBe("pending_validation");
    expect(detail.reviews).toEqual([]);
  });

  /* Validated and unreviewed shared one confidence, so the pack could not put the first ahead. */
  it("puts what a person validated ahead of what nobody read in what agents are told", async () => {
    const project = await newProject("pack");
    const { entry: unread } = await saveContext(
      { content: `Deploys go out on Tuesdays ${RID}.`, project: project.name, type: "decision", createdBy: OWNER },
      { useClassifier: false, detectImprovements: false },
    );
    const confirmed = await distilled(project, `Feature flags are removed within a sprint ${RID}.`);
    await judgeOnTheWeb(confirmed, "validated");

    const decisions = (await getContextPack(project.name)).sections.find((s) => s.type === "decision")!.entries.map((e) => e.id);
    expect(decisions.indexOf(confirmed)).toBeLessThan(decisions.indexOf(unread.id));
  });
});

/* An agent's "validated" is a model's judgement: it must not read as a person's (ADR-0090). */
describe("an agent reviewing a memo through MCP", () => {
  it("changes its status and records the verdict, and leaves its confidence alone", async () => {
    const id = await distilled(await newProject("mcp"), `The importer skips rows without an id ${RID}.`);

    await validateEntry(id, "validated", { email: OWNER, channel: "mcp" });

    const detail = (await getEntryDetail(id))!;
    expect(detail.entry.status).toBe("validated");
    expect(detail.entry.confidence).toBe("low");
    expect(detail.reviews.map((r) => [r.verdict, r.channel])).toEqual([["validated", "mcp"]]);
  });
});

describe("the review history", () => {
  it("keeps every verdict, the newest first", async () => {
    const id = await distilled(await newProject("history"), `Sessions expire after eight hours ${RID}.`);

    await judgeOnTheWeb(id, "validated");
    await validateEntry(id, "obsolete", { email: null, channel: "mcp" });

    const reviews = (await getEntryDetail(id))!.reviews;
    expect(reviews.map((r) => [r.verdict, r.channel, r.reviewedBy])).toEqual([
      ["obsolete", "mcp", null],
      ["validated", "web", OWNER],
    ]);
  });

  it("goes with the memo when the memo is purged", async () => {
    const id = await distilled(await newProject("purge"), `The archive is kept for ninety days ${RID}.`);
    await judgeOnTheWeb(id, "rejected");

    await purgeEntries([id], { email: OWNER });

    const [left] = (await getSql()`SELECT count(*)::int AS n FROM memo_reviews WHERE memo_id = ${id}`) as unknown as { n: number }[];
    expect(left!.n).toBe(0);
  });
});

/*
 * A distilled memo a person had validated was still merged and superseded on its own, because
 * reconciliation only looked at where it came from: the verified text could be rewritten by a
 * model, and keep saying "verified" (ADR-0090).
 */
describe("reconciliation, once a person has verified a memo", () => {
  // Scores ~0.88 with the tests' local embeddings: inside the band where the reconciler is asked.
  const original = "The retry backoff is exponential, capped at 60 seconds, with jitter.";
  const paraphrase = "The retry backoff is exponential, capped at 60 seconds, with random jitter to avoid synchronisation.";
  const incoming = (project: ProjectRef) =>
    ({ content: paraphrase, project: project.name, type: "decision", confidence: "low", sourceType: "agent_session", sourceReference: `claude:${RID}-2` }) as never;
  const opts = { useClassifier: false, detectImprovements: false } as const;

  async function reconcileWith(decision: "update" | "supersede", run: () => Promise<void>): Promise<void> {
    setReconciler({ decide: async () => decision, merge: async (existing: string, next: string) => `${existing} ${next}` });
    try {
      await run();
    } finally {
      setReconciler(null);
    }
  }

  it("still merges into a distilled memo nobody verified (the control)", async () => {
    const project = await newProject("merge-control");
    const id = await distilled(project, original);
    await reconcileWith("update", async () => {
      expect((await saveWithReconciliation(incoming(project), opts)).action).toBe("update");
    });
    expect((await getEntryDetail(id))!.entry.content).not.toBe(original);
  });

  it("does not merge into it: the newcomer is added beside it", async () => {
    const project = await newProject("merge");
    const id = await distilled(project, original);
    await judgeOnTheWeb(id, "validated");
    await reconcileWith("update", async () => {
      expect((await saveWithReconciliation(incoming(project), opts)).action).toBe("add");
    });
    expect((await getEntryDetail(id))!.entry.content).toBe(original);
  });

  it("does not invalidate it: the contradiction is flagged for a person", async () => {
    const project = await newProject("supersede");
    const id = await distilled(project, original);
    await judgeOnTheWeb(id, "validated");
    await reconcileWith("supersede", async () => {
      expect((await saveWithReconciliation(incoming(project), opts)).action).toBe("contradict");
    });
    const kept = (await getEntryDetail(id))!.entry;
    expect(kept.validTo).toBeNull();
    expect(kept.status).toBe("validated");
  });

  it("the after-the-fact dedup never drops the copy a person verified, even the newer one", async () => {
    const content = `Invoices are numbered per fiscal year ${RID}.`;
    const control = await newProject("dedup-control");
    await distilled(control, content);
    await distilled(control, content);
    expect((await reconcileProject(control.name)).deduped).toBe(1);

    const project = await newProject("dedup");
    const older = await distilled(project, content);
    const newer = await distilled(project, content);
    await judgeOnTheWeb(newer, "validated");

    expect((await reconcileProject(project.name)).deduped).toBe(0);
    expect((await getEntryDetail(newer))!.entry.validTo).toBeNull();
    expect((await getEntryDetail(older))!.entry.validTo).toBeNull();
  });
});

import { describe, it, expect, afterEach, beforeAll } from "vitest";
import { getSql } from "@cortex/database";
import {
  createProject,
  indexMemos,
  nextReview,
  nextUnchecked,
  pendingReviewCount,
  projectAutoMerges,
  requestOtp,
  saveContext,
  setGroupJudge,
  setMergeDrafter,
  sweepProject,
  uncheckedCount,
  validateEntry,
  verifyOtp,
  type GroupJudge,
  type MergeSource,
  type ProjectRef,
} from "@cortex/core";
import { createApp as createWebApp } from "../../apps/web/src/app.js";

const RID = Math.random().toString(36).slice(2, 8);
const OWNER = `sweep-owner-${RID}@example.com`;

// Close enough with the tests' local embeddings to be the same thing, which is what the pass
// raises without a model.
const TOKENS = [
  "Session tokens expire after fifteen minutes without activity.",
  "Session tokens expire after fifteen minutes without any activity.",
  "Session tokens always expire after fifteen minutes without activity.",
] as const;

let ownerCookie: string;

beforeAll(async () => {
  let captured = "";
  const log = console.log;
  console.log = ((...a: unknown[]) => {
    captured += a.join(" ") + "\n";
  }) as typeof console.log;
  try {
    await requestOtp(OWNER);
  } finally {
    console.log = log;
  }
  const code = captured.split("\n").find((l) => l.includes(OWNER))?.match(/(\d{6})/)?.[1];
  if (!code) throw new Error(`the OTP for ${OWNER} was not captured`);
  ownerCookie = `cortex_session=${(await verifyOtp(OWNER, code)).token}`;
}, 120_000);

const newProject = (label: string): Promise<ProjectRef> => createProject(`Sweep ${label} ${RID}`, { ownerEmail: OWNER });

/** Saved as a bulk upload saves, and embedded afterwards with no review raised: what a save missed. */
async function missedAtSave(project: ProjectRef, content: string): Promise<string> {
  const { entry } = await saveContext({ content, project: project.name, type: "decision", createdBy: OWNER }, { useClassifier: false, skipEmbedding: true });
  await indexMemos([{ memoId: entry.id, text: content }]);
  return entry.id;
}

async function save(project: ProjectRef, content: string): Promise<string> {
  const { entry } = await saveContext({ content, project: project.name, type: "decision", createdBy: OWNER }, { useClassifier: false });
  return entry.id;
}

async function judgedAs(groups: Awaited<ReturnType<GroupJudge>>): Promise<{ seen: Parameters<GroupJudge>[] }> {
  const seen: Parameters<GroupJudge>[] = [];
  setGroupJudge(async (...args) => {
    seen.push(args);
    return groups && groups.map((g) => ({ ...g, memoIds: g.memoIds.map((id) => (id === "day" ? args[0].id : id)) }));
  });
  return { seen };
}

afterEach(() => {
  setGroupJudge(null);
  setMergeDrafter(null);
});

/*
 * A save sets a memo against the six nearest from 0.75, the reconciler against the nearest alone,
 * and a memo uploaded in bulk has no vector until its batch ends: a memo saved meanwhile never
 * meets it, and the upload then skips it as newer (ADR-0094). Those duplicates stayed in force,
 * both handed to agents as true, with nothing bringing them back (ADR-0098).
 */
describe("the nightly second pass", () => {
  it("raises, without a model, a duplicate a save missed, as a review of the older memo", async () => {
    const project = await newProject("missed");
    const older = await missedAtSave(project, TOKENS[0]);
    const newer = await missedAtSave(project, TOKENS[1]);
    expect(await nextReview(project)).toBeNull();

    const report = await sweepProject(project.name);

    expect(report).toMatchObject({ swept: 2, judged: 0, raised: 1 });
    const review = await nextReview(project);
    expect(review?.memo.id).toBe(older);
    expect(review?.newer.map((n) => ({ id: n.memo.id, finding: n.finding }))).toEqual([{ id: newer, finding: null }]);
    const [row] = await getSql()`SELECT raised_by FROM review_queue WHERE memo_id = ${older} AND newer_memo_id = ${newer}`;
    expect(row?.raised_by).toBe("sweep");
  });

  it("raises three memos about one thing as one review on the oldest, with what the agent said of them", async () => {
    const project = await newProject("group");
    const ids = [];
    for (const text of TOKENS) ids.push(await missedAtSave(project, text));
    const { seen } = await judgedAs([{ memoIds: ["day", ids[1]!, ids[2]!], relation: "duplicate", reason: `All three set the session timeout ${RID}.` }]);

    const report = await sweepProject(project.name);

    expect(report.raised).toBe(1);
    expect(await pendingReviewCount(project)).toBe(1);
    const review = await nextReview(project);
    expect(review?.memo.id).toBe(ids[0]);
    expect(review?.newer.map((n) => n.memo.id).sort()).toEqual([ids[1], ids[2]].sort());
    expect(review?.newer.map((n) => n.finding)).toEqual([0, 1].map(() => ({ relation: "duplicate", reason: `All three set the session timeout ${RID}.` })));
    // The first memo of the day brought the other two into its group, so they were not judged again.
    expect(seen.map(([memo, , context]) => ({ memo: memo.id, context }))).toEqual([{ memo: ids[0], context: { language: expect.any(String), projectId: project.id } }]);

    const html = await (await createWebApp().request(`/p/${project.slug}/review`, { headers: { cookie: ownerCookie } })).text();
    expect(html).toContain("Says the same");
    expect(html).toContain(`All three set the session timeout ${RID}.`);
  });

  it("raises nothing the agent leaves out, however alike it reads", async () => {
    const project = await newProject("set-aside");
    await missedAtSave(project, TOKENS[0]);
    await missedAtSave(project, TOKENS[1]);
    await judgedAs([]);

    expect((await sweepProject(project.name)).raised).toBe(0);
    expect(await nextReview(project)).toBeNull();
  });

  it("falls back to similarity when the agent fails, rather than losing the night", async () => {
    const project = await newProject("judge-fails");
    await missedAtSave(project, TOKENS[0]);
    await missedAtSave(project, TOKENS[1]);
    setGroupJudge(async () => {
      throw new Error("provider down");
    });

    expect(await sweepProject(project.name)).toMatchObject({ judged: 1, raised: 1 });
  });

  it("does not ask again about a pair a person already decided", async () => {
    const project = await newProject("decided");
    const older = await save(project, TOKENS[0]);
    await save(project, TOKENS[1]);
    expect((await nextReview(project))?.memo.id).toBe(older);
    await getSql()`UPDATE review_queue SET status = 'resolved', resolution = 'kept', resolved_by = ${OWNER}, resolved_at = now() WHERE memo_id = ${older}`;

    expect((await sweepProject(project.name)).raised).toBe(0);
    expect(await nextReview(project)).toBeNull();
  });

  it("starts each night where the last one ended, so a memo is swept once", async () => {
    const project = await newProject("watermark");
    await missedAtSave(project, TOKENS[0]);
    await missedAtSave(project, TOKENS[1]);
    expect((await sweepProject(project.name)).swept).toBe(2);
    expect(await sweepProject(project.name)).toMatchObject({ swept: 0, raised: 0 });

    const third = await missedAtSave(project, TOKENS[2]);
    const next = await sweepProject(project.name);
    expect(next).toMatchObject({ swept: 1, raised: 1 });
    expect((await nextReview(project))?.newer.map((n) => n.memo.id)).toContain(third);
  });

  it("leaves the backlog alone: a project's first pass looks back one day", async () => {
    const project = await newProject("backlog");
    const ids = [await missedAtSave(project, TOKENS[0]), await missedAtSave(project, TOKENS[1])];
    await getSql()`UPDATE memos SET created_at = now() - interval '2 days' WHERE id = ANY(${ids})`;

    expect(await sweepProject(project.name)).toMatchObject({ swept: 0, raised: 0 });
  });
});

const MERGED = { title: `Session timeout ${RID}`, content: `Session tokens expire after fifteen minutes of inactivity ${RID}.` };

function mergerDrafts(): { asked: MergeSource[][] } {
  const asked: MergeSource[][] = [];
  setMergeDrafter(async (memos) => {
    asked.push(memos);
    return MERGED;
  });
  return { asked };
}

async function switchOnAutoMerge(project: ProjectRef): Promise<Response> {
  return createWebApp().request(`/p/${project.slug}/settings/auto-merge`, {
    method: "POST",
    headers: { cookie: ownerCookie, "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ on: "1" }).toString(),
  });
}

/*
 * Review waited on a person for every group the nightly pass raised, including the ones its agent
 * had already judged to say the same thing, and a project with more memos than reviewers kept them
 * all in force, every copy handed to agents. A project can now let the pass merge those itself;
 * a contradiction and a verified memo still wait for a person, and it is off unless asked (ADR-0103).
 */
describe("a project that lets the nightly pass merge on its own", () => {
  it("is off by default: a duplicate the agent found waits for a person, even with a model to merge it", async () => {
    const project = await newProject("auto-off");
    await missedAtSave(project, TOKENS[0]);
    const newer = await missedAtSave(project, TOKENS[1]);
    await judgedAs([{ memoIds: ["day", newer], relation: "duplicate", reason: "Same timeout." }]);
    const { asked } = mergerDrafts();

    expect(await projectAutoMerges(project.id)).toBe(false);
    expect(await sweepProject(project.name)).toMatchObject({ raised: 1, merged: 0 });
    expect(asked).toEqual([]);
  });

  it("switched on in Settings, merges a duplicate with no review: the merged memo replaces them and waits to be checked", async () => {
    const project = await newProject("auto-on");
    const ids = [];
    for (const text of TOKENS) ids.push(await missedAtSave(project, text));
    await judgedAs([{ memoIds: ["day", ids[1]!, ids[2]!], relation: "duplicate", reason: "All three set the timeout." }]);
    const { asked } = mergerDrafts();

    expect((await switchOnAutoMerge(project)).status).toBe(302);
    expect(await projectAutoMerges(project.id)).toBe(true);
    const settings = await (await createWebApp().request(`/p/${project.slug}/settings`, { headers: { cookie: ownerCookie } })).text();
    expect(settings).toMatch(/name="on" value="1" checked> Merge them without asking/);

    expect(await sweepProject(project.name)).toMatchObject({ raised: 0, merged: 1 });

    expect(asked.map((memos) => memos.map((m) => m.content))).toEqual([[...TOKENS]]);
    const originals = await getSql()`SELECT DISTINCT superseded_by FROM memos WHERE id = ANY(${ids}) AND status = 'superseded'`;
    expect(originals).toHaveLength(1);
    const mergedId = String(originals[0]!.superseded_by);
    const [merged] = await getSql()`SELECT title, content, source_type, confidence, metadata FROM memos WHERE id = ${mergedId}`;
    expect(merged).toMatchObject({ title: MERGED.title, content: MERGED.content, source_type: "agent_session", confidence: "medium" });
    expect(merged?.metadata).toMatchObject({ mergedFrom: ids, mergedBy: "sweep" });

    expect(await pendingReviewCount(project)).toBe(0);
    expect(await uncheckedCount(project)).toBe(1);
    expect((await nextUnchecked(project))?.memo.id).toBe(mergedId);
  });

  it("leaves a contradiction to a person: which side holds is the question", async () => {
    const project = await newProject("auto-contradiction");
    await missedAtSave(project, TOKENS[0]);
    const newer = await missedAtSave(project, TOKENS[1]);
    await judgedAs([{ memoIds: ["day", newer], relation: "contradiction", reason: "They disagree." }]);
    const { asked } = mergerDrafts();
    await switchOnAutoMerge(project);

    expect(await sweepProject(project.name)).toMatchObject({ raised: 1, merged: 0 });
    expect(asked).toEqual([]);
  });

  it("never merges a memo a person verified", async () => {
    const project = await newProject("auto-verified");
    const older = await missedAtSave(project, TOKENS[0]);
    const newer = await missedAtSave(project, TOKENS[1]);
    await validateEntry(older, "validated", { email: OWNER, channel: "web" });
    await judgedAs([{ memoIds: ["day", newer], relation: "duplicate", reason: "Same timeout." }]);
    mergerDrafts();
    await switchOnAutoMerge(project);

    expect(await sweepProject(project.name)).toMatchObject({ raised: 1, merged: 0 });
    expect((await nextReview(project))?.memo.id).toBe(older);
  });

  it("hands the group to a person when the merger fails, rather than losing it", async () => {
    const project = await newProject("auto-merger-fails");
    const older = await missedAtSave(project, TOKENS[0]);
    const newer = await missedAtSave(project, TOKENS[1]);
    await judgedAs([{ memoIds: ["day", newer], relation: "overlap", reason: "Each holds half." }]);
    setMergeDrafter(async () => {
      throw new Error("provider down");
    });
    await switchOnAutoMerge(project);

    expect(await sweepProject(project.name)).toMatchObject({ raised: 1, merged: 0 });
    expect((await nextReview(project))?.memo.id).toBe(older);
  });
});

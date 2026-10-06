import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { closeSql, getSql } from "@cortex/database";
import {
  addProjectMember,
  createProject,
  findPurgeScope,
  getEntryDetail,
  NotAManagerError,
  requestOtp,
  saveContext,
  verifyOtp,
  type ProjectRef,
} from "@cortex/core";
import type { PurgeEntriesResponse, PurgeProjectPreview } from "@cortex/shared";
import { createApp as createServerApp } from "../../apps/server/src/app.js";

const RID = Math.random().toString(36).slice(2, 8);
const OWNER = `scope-owner-${RID}@example.com`;
const MEMBER = `scope-member-${RID}@example.com`;
const OUTSIDER = `scope-outsider-${RID}@example.com`;

const TOPICS = [
  "the retry queue drains in batches of four",
  "staging is reset every Monday at seven",
  "the worker cold start is nine seconds",
  "invoices are signed with the vendor key",
  "the search index is rebuilt at night",
  "feature flags live in the settings table",
  "uploads above ten megabytes are refused",
  "the mobile app pins the API version",
];
let topic = 0;

async function tokenFor(email: string): Promise<string> {
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
  return (await verifyOtp(email, code)).token;
}

let tokOwner: string;
let tokMember: string;
let tokOutsider: string;
let projects = 0;

async function freshProject(): Promise<{ project: ProjectRef; child: ProjectRef; elsewhere: ProjectRef }> {
  const n = ++projects;
  const project = await createProject(`IT Scope ${RID} ${n}`, { visibility: "private", ownerEmail: OWNER });
  await addProjectMember(project.slug!, MEMBER, { email: OWNER });
  const child = await createProject(`IT Scope ${RID} ${n} child`, { ownerEmail: OWNER, parentSlug: project.slug });
  const elsewhere = await createProject(`IT Scope ${RID} ${n} elsewhere`, { ownerEmail: OWNER });
  return { project, child, elsewhere };
}

async function memoAddedOn(target: ProjectRef, day: string, type: "decision" | "other" = "decision"): Promise<string> {
  const subject = TOPICS[topic++ % TOPICS.length];
  const { entry } = await saveContext(
    { content: `${RID} ${topic}: ${subject}.`, title: `${subject} ${RID} ${topic}`, project: target.name, type, createdBy: OWNER },
    { useClassifier: false },
  );
  await getSql()`UPDATE memos SET created_at = ${new Date(`${day}T12:00:00Z`)} WHERE id = ${entry.id}`;
  return entry.id;
}

const day = (iso: string) => new Date(`${iso}T00:00:00Z`);
const sorted = (ids: string[]) => [...ids].sort();
const stillThere = async (ids: string[]) =>
  (await Promise.all(ids.map(getEntryDetail))).flatMap((d, i) => (d ? [ids[i]!] : []));

const api = (token: string, slug: string, body: unknown) =>
  createServerApp().request(`/projects/${slug}/purge`, {
    method: "POST",
    headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
    body: JSON.stringify(body),
  });

beforeAll(async () => {
  tokOwner = await tokenFor(OWNER);
  tokMember = await tokenFor(MEMBER);
  tokOutsider = await tokenFor(OUTSIDER);
}, 120_000);

afterAll(async () => {
  await closeSql();
});

/*
 * A purge by scope deletes memos nobody looked at one by one (ADR-0087), so what the scope
 * reaches is the whole safety: a day must not leak into the next, and a project must never
 * reach into its children or into another project.
 */
describe("the memos a purge scope reaches", () => {
  it("a period takes every memo added in it, and none from either side, from a child or from another project", async () => {
    const { project, child, elsewhere } = await freshProject();
    const inside = [await memoAddedOn(project, "2026-03-02"), await memoAddedOn(project, "2026-03-02")];
    await memoAddedOn(project, "2026-03-01");
    await memoAddedOn(project, "2026-03-03");
    await memoAddedOn(child, "2026-03-02");
    await memoAddedOn(elsewhere, "2026-03-02");

    const scoped = await findPurgeScope(
      { project: project.slug!, periods: [{ field: "created", from: day("2026-03-02"), to: day("2026-03-03") }], writtenBefore: new Date() },
      { email: OWNER },
    );
    expect(sorted(scoped.map((m) => m.id))).toEqual(sorted(inside));
  }, 60_000);

  it("type and status narrow it, and with no period it is the whole project", async () => {
    const { project } = await freshProject();
    const decisions = [await memoAddedOn(project, "2026-01-10"), await memoAddedOn(project, "2026-02-10")];
    const other = await memoAddedOn(project, "2026-02-10", "other");
    const asOf = new Date();

    const all = await findPurgeScope({ project: project.slug!, writtenBefore: asOf }, { email: OWNER });
    expect(sorted(all.map((m) => m.id))).toEqual(sorted([...decisions, other]));
    const onlyOther = await findPurgeScope({ project: project.slug!, type: "other", writtenBefore: asOf }, { email: OWNER });
    expect(onlyOther.map((m) => m.id)).toEqual([other]);
    const noneValidated = await findPurgeScope({ project: project.slug!, status: "validated", writtenBefore: asOf }, { email: OWNER });
    expect(noneValidated).toEqual([]);
  }, 60_000);

  it("a memo written after the scope was read -- new, or an old one changed -- is not in it", async () => {
    const { project } = await freshProject();
    const untouched = await memoAddedOn(project, "2026-04-01");
    const changed = await memoAddedOn(project, "2026-04-01");
    const asOf = new Date();
    await getSql()`UPDATE memos SET title = title || ' (edited)' WHERE id = ${changed}`;
    await memoAddedOn(project, "2026-04-01");

    const scoped = await findPurgeScope({ project: project.slug!, writtenBefore: asOf }, { email: OWNER });
    expect(scoped.map((m) => m.id)).toEqual([untouched]);
  }, 60_000);

  it("only whoever manages the project may read a scope", async () => {
    const { project } = await freshProject();
    await expect(findPurgeScope({ project: project.slug!, writtenBefore: new Date() }, { email: MEMBER })).rejects.toBeInstanceOf(
      NotAManagerError,
    );
  });
});

describe("POST /projects/:slug/purge", () => {
  it("without confirm it purges nothing, and says how many, of which types, and as of when", async () => {
    const { project } = await freshProject();
    const ids = [await memoAddedOn(project, "2026-05-04"), await memoAddedOn(project, "2026-05-06", "other")];

    const res = await api(tokOwner, project.slug!, {});
    expect(res.status).toBe(200);
    const preview = (await res.json()) as PurgeProjectPreview;
    expect(preview).toMatchObject({
      count: 2,
      byType: { decision: 1, other: 1 },
      oldest: "2026-05-04T12:00:00.000Z",
      newest: "2026-05-06T12:00:00.000Z",
    });
    expect(Number.isNaN(Date.parse(preview.asOf))).toBe(false);
    expect(await stillThere(ids)).toEqual(ids);
  }, 60_000);

  it("confirm must be the slug: anything else is a 400 and nothing goes", async () => {
    const { project } = await freshProject();
    const ids = [await memoAddedOn(project, "2026-05-04")];
    for (const confirm of ["yes", "purge", project.name, ""]) {
      expect((await api(tokOwner, project.slug!, { confirm })).status, confirm).toBe(400);
    }
    expect(await stillThere(ids)).toEqual(ids);
  }, 60_000);

  it("with the slug it purges the scope, leaves the child's and what came after the preview, and audits each one", async () => {
    const { project, child } = await freshProject();
    const doomed = [await memoAddedOn(project, "2026-06-01"), await memoAddedOn(project, "2026-06-02"), await memoAddedOn(project, "2026-06-03")];
    const childs = await memoAddedOn(child, "2026-06-02");
    const preview = (await (await api(tokOwner, project.slug!, {})).json()) as PurgeProjectPreview;
    const late = await memoAddedOn(project, "2026-06-02");

    const res = await api(tokOwner, project.slug!, { confirm: project.slug, writtenBefore: preview.asOf });
    expect(res.status).toBe(200);
    expect(sorted(((await res.json()) as PurgeEntriesResponse).purged)).toEqual(sorted(doomed));
    expect(await stillThere([...doomed, childs, late])).toEqual([childs, late]);

    const audited = (await getSql()`
      SELECT entry_id, purged_by FROM entry_purges WHERE entry_id = ANY(${doomed}::uuid[])
    `) as unknown as { entry_id: string; purged_by: string }[];
    expect(sorted(audited.map((r) => r.entry_id))).toEqual(sorted(doomed));
    expect(new Set(audited.map((r) => r.purged_by))).toEqual(new Set([OWNER]));
  }, 60_000);

  it("a period from the API takes that span only", async () => {
    const { project } = await freshProject();
    const march = await memoAddedOn(project, "2026-03-15");
    const april = await memoAddedOn(project, "2026-04-15");
    const res = await api(tokOwner, project.slug!, {
      confirm: project.slug,
      periods: [{ from: "2026-03-01T00:00:00Z", to: "2026-04-01T00:00:00Z" }],
    });
    expect(((await res.json()) as PurgeEntriesResponse).purged).toEqual([march]);
    expect(await stillThere([march, april])).toEqual([april]);
  }, 60_000);

  it("a member who can read it gets 403, someone who cannot see it 404, and nothing goes", async () => {
    const { project } = await freshProject();
    const ids = [await memoAddedOn(project, "2026-05-04")];
    expect((await api(tokMember, project.slug!, { confirm: project.slug })).status).toBe(403);
    expect((await api(tokMember, project.slug!, {})).status).toBe(403);
    expect((await api(tokOutsider, project.slug!, { confirm: project.slug })).status).toBe(404);
    expect(await stillThere(ids)).toEqual(ids);
  }, 60_000);
});

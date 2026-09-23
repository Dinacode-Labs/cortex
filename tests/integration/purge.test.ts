import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { closeSql, getSql } from "@cortex/database";
import {
  addProjectMember,
  createProject,
  getContextPack,
  getEntryDetail,
  getProjectGraph,
  invalidateEntry,
  linkEntryToEntity,
  lintProject,
  NotAManagerError,
  purgeEntries,
  relateEntries,
  renderContextPack,
  requestOtp,
  resolveEntity,
  saveContext,
  searchContext,
  verifyOtp,
  type ProjectRef,
} from "@cortex/core";
import { createApp as createServerApp } from "../../apps/server/src/app.js";
import { createApp as createWebApp } from "../../apps/web/src/app.js";

/**
 * Purging an entry (ADR-0072).
 *
 * A test project went from 182 to ~330 entries in two days, nearly all distilled from lab
 * sessions, and marking them rejected left every one of them linked, counted and searchable.
 * What is tested is that a purge leaves nothing that brings the entry back -- not search, not
 * the pack, not the map, not Health, not a row pointing at it -- and that only whoever manages
 * the project can do it.
 */
const RID = Math.random().toString(36).slice(2, 8);
const OWNER = `purge-owner-${RID}@example.com`;
const MEMBER = `purge-member-${RID}@example.com`;
const OUTSIDER = `purge-outsider-${RID}@example.com`;
const MARKER = `zqpurge${RID}`;

async function tokenFor(email: string): Promise<string> {
  // The code is looked for on THIS email's line: other integration files intercept
  // `console.log` at the same time.
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
let project: ProjectRef;
let otherProject: ProjectRef;

async function save(title: string, content: string, target: ProjectRef = project): Promise<{ id: string; sourceId: string }> {
  const { entry } = await saveContext(
    { content, title, project: target.name, type: "decision", createdBy: OWNER },
    { useClassifier: false },
  );
  const [row] = (await getSql()`SELECT source_id FROM context_entries WHERE id = ${entry.id}`) as unknown as { source_id: string }[];
  return { id: entry.id, sourceId: row!.source_id };
}

const count = async (query: Promise<unknown>): Promise<number> => Number(((await query) as { n: number }[])[0]!.n);

beforeAll(async () => {
  tokOwner = await tokenFor(OWNER);
  tokMember = await tokenFor(MEMBER);
  tokOutsider = await tokenFor(OUTSIDER);
  project = await createProject(`IT Purge ${RID}`, { visibility: "private", ownerEmail: OWNER });
  otherProject = await createProject(`IT Purge Other ${RID}`, { visibility: "public", ownerEmail: OUTSIDER });
  await addProjectMember(project.slug!, MEMBER, OWNER);
}, 120_000);

afterAll(async () => {
  await closeSql();
});

const api = (token: string, ids: string[]) =>
  createServerApp().request("/entries/purge", {
    method: "POST",
    headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
    body: JSON.stringify({ ids }),
  });

describe("purging an entry leaves nothing behind", () => {
  it("gone from search, the pack, the map and Health, with no row still pointing at it", async () => {
    const doomed = await save(`Doomed ${MARKER}`, `Decision ${MARKER}: the lab run writes to src/ghost.ts on every boot.`);
    const kept = await save(`Kept ${MARKER}`, `Decision ${MARKER}: retries go through the payments queue.`);
    const superseded = await save(`Older ${MARKER}`, `Decision ${MARKER}: retries go through a cron job every minute.`);
    await invalidateEntry(superseded.id, doomed.id);
    await relateEntries(doomed.id, kept.id, "contradicts");

    const sql = getSql();
    const onlyDoomed = await resolveEntity(sql, `ghostmodule${RID}`, "module");
    const shared = await resolveEntity(sql, `paymentsqueue${RID}`, "module");
    await linkEntryToEntity(sql, doomed.id, onlyDoomed.id);
    await linkEntryToEntity(sql, doomed.id, shared.id);
    await linkEntryToEntity(sql, kept.id, shared.id);

    expect((await searchContext({ query: MARKER, project: project.name, limit: 20 })).map((h) => h.entry.id)).toContain(doomed.id);

    const res = await api(tokOwner, [doomed.id]);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ purged: [doomed.id] });

    expect(await getEntryDetail(doomed.id)).toBeNull();
    const hits = await searchContext({ query: MARKER, project: project.name, limit: 20 });
    expect(hits.map((h) => h.entry.id)).not.toContain(doomed.id);
    expect(hits.map((h) => h.entry.id)).toContain(kept.id);
    expect(renderContextPack(await getContextPack(project.name))).not.toContain(`Doomed ${MARKER}`);
    const graph = await getProjectGraph(project.name);
    expect(graph.nodes.map((n) => n.id)).not.toContain(doomed.id);
    expect(graph.nodes.map((n) => n.id)).not.toContain(onlyDoomed.id);
    const lint = await lintProject(project.name);
    expect(lint.contradictions.filter((c) => c.aId === doomed.id || c.bId === doomed.id)).toEqual([]);

    const dangling = {
      relations: await count(sql`SELECT count(*)::int n FROM relations WHERE source_id = ${doomed.id} OR target_id = ${doomed.id}`),
      embeddings: await count(sql`SELECT count(*)::int n FROM embeddings WHERE context_entry_id = ${doomed.id}`),
      entityLinks: await count(sql`SELECT count(*)::int n FROM context_entry_entities WHERE context_entry_id = ${doomed.id}`),
      supersededBy: await count(sql`SELECT count(*)::int n FROM context_entries WHERE superseded_by = ${doomed.id}`),
      source: await count(sql`SELECT count(*)::int n FROM sources WHERE id = ${doomed.sourceId}`),
      entityOnlyItNamed: await count(sql`SELECT count(*)::int n FROM entities WHERE id = ${onlyDoomed.id}`),
    };
    expect(dangling).toEqual({ relations: 0, embeddings: 0, entityLinks: 0, supersededBy: 0, source: 0, entityOnlyItNamed: 0 });
    expect(await count(sql`SELECT count(*)::int n FROM entities WHERE id = ${shared.id}`)).toBe(1);
  });

  it("an entry the purged one superseded is current again and waits for a person", async () => {
    const doomed = await save(`Newer ${MARKER} b`, `Decision ${MARKER}: builds run on the lab runner only.`);
    const older = await save(`Older ${MARKER} b`, `Decision ${MARKER}: builds run on the shared CI runner.`);
    await invalidateEntry(older.id, doomed.id);

    await purgeEntries([doomed.id], OWNER);

    const [row] = (await getSql()`
      SELECT status, validity, valid_to, superseded_by FROM context_entries WHERE id = ${older.id}
    `) as unknown as { status: string; validity: string; valid_to: Date | null; superseded_by: string | null }[];
    expect(row).toEqual({ status: "pending_validation", validity: "current", valid_to: null, superseded_by: null });
  });

  it("keeps who purged what and when, and not what it said", async () => {
    const doomed = await save(`Audited ${MARKER}`, `Decision ${MARKER}: a secret-looking sentence that must not survive.`);
    await purgeEntries([doomed.id], OWNER);
    const rows = (await getSql()`SELECT * FROM entry_purges WHERE entry_id = ${doomed.id}`) as unknown as Record<string, unknown>[];
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ project_id: project.id, purged_by: OWNER, entry_type: "decision" });
    expect(JSON.stringify(rows[0])).not.toContain("secret-looking");
  });
});

describe("who may purge", () => {
  it("a member who can read the project but not manage it gets 403, and the entry stays", async () => {
    const entry = await save(`Member ${MARKER}`, `Decision ${MARKER}: members read, owners purge.`);
    expect((await api(tokMember, [entry.id])).status).toBe(403);
    expect((await api(tokOutsider, [entry.id])).status).toBe(403);
    expect(await getEntryDetail(entry.id)).not.toBeNull();
  });

  it("one entry the caller cannot manage stops the whole batch", async () => {
    const mine = await save(`Mine ${MARKER}`, `Decision ${MARKER}: the owner's own entry.`);
    const theirs = await save(`Theirs ${MARKER}`, `Decision ${MARKER}: someone else's public project.`, otherProject);
    await expect(purgeEntries([mine.id, theirs.id], OWNER)).rejects.toBeInstanceOf(NotAManagerError);
    expect((await api(tokOwner, [mine.id, theirs.id])).status).toBe(403);
    expect(await getEntryDetail(mine.id)).not.toBeNull();
    expect(await getEntryDetail(theirs.id)).not.toBeNull();
  });

  it("an id that does not exist is a 404 naming it, and nothing else in the request is purged", async () => {
    const entry = await save(`Real ${MARKER}`, `Decision ${MARKER}: this one exists.`);
    const ghost = "00000000-0000-4000-8000-000000000000";
    const res = await api(tokOwner, [entry.id, ghost]);
    expect(res.status).toBe(404);
    expect(((await res.json()) as { missing: string[] }).missing).toEqual([ghost]);
    expect(await getEntryDetail(entry.id)).not.toBeNull();
    expect((await api(tokOwner, ["not-a-uuid"])).status).toBe(400);
  });
});

describe("the entry page", () => {
  const web = (token: string, path: string, init: RequestInit = {}) =>
    createWebApp().request(path, { ...init, headers: { cookie: `cortex_session=${token}`, ...(init.headers ?? {}) } });

  it("offers Purge only to whoever manages the project, and purges after the confirmation", async () => {
    const entry = await save(`Web ${MARKER}`, `Decision ${MARKER}: purged from the page.`);

    expect(await (await web(tokOwner, `/entry/${entry.id}`)).text()).toContain(`/entry/${entry.id}?purge=1`);
    expect(await (await web(tokMember, `/entry/${entry.id}`)).text()).not.toContain("?purge=1");
    expect(await (await web(tokMember, `/entry/${entry.id}?purge=1`)).text()).not.toContain(`/entry/${entry.id}/purge`);
    expect(await (await web(tokOwner, `/entry/${entry.id}?purge=1`)).text()).toContain(`action="/entry/${entry.id}/purge"`);

    expect((await web(tokMember, `/entry/${entry.id}/purge`, { method: "POST" })).status).toBe(403);
    expect(await getEntryDetail(entry.id)).not.toBeNull();

    const res = await web(tokOwner, `/entry/${entry.id}/purge`, { method: "POST" });
    expect(res.status).toBe(302);
    expect(res.headers.get("location")).toBe(`/p/${project.slug}`);
    expect(await getEntryDetail(entry.id)).toBeNull();
  });
});

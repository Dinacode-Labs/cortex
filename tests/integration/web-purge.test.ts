import { describe, it, expect, beforeAll } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { getSql } from "@cortex/database";
import { createProject, getEntryDetail, requestOtp, saveContext, verifyOtp, type ProjectRef } from "@cortex/core";
import { createApp as createWebApp } from "../../apps/web/src/app.js";

const RID = Math.random().toString(36).slice(2, 8);
const OWNER = `purge-owner-${RID}@example.com`;
const VISITOR = `purge-visitor-${RID}@example.com`;
const CSS = readFileSync(resolve(import.meta.dirname, "../../apps/web/public/styles.css"), "utf8");

async function otpDe(email: string): Promise<string> {
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
  const line = cap.split("\n").find((l) => l.includes(email));
  const m = line?.match(/(\d{6})/);
  if (!m) throw new Error(`the OTP for ${email} was not captured`);
  return m[1]!;
}

let ownerCookie: string;
let visitorCookie: string;
let project_: ProjectRef;
let other: ProjectRef;
let otherEntryId: string;

const CONTENTS = [
  `Lab session ${RID}: tried the retry queue with a batch size of four.`,
  `Lab session ${RID}: the staging database was reset twice this morning.`,
  `Lab session ${RID}: measured cold start of the worker at nine seconds.`,
];

async function seedEntries(): Promise<string[]> {
  const ids: string[] = [];
  for (const content of CONTENTS) {
    const { entry } = await saveContext({ content: `${content} ${Math.random()}`, project: project_.name, createdBy: OWNER });
    ids.push(entry.id);
  }
  return ids;
}

beforeAll(async () => {
  ownerCookie = `cortex_session=${(await verifyOtp(OWNER, await otpDe(OWNER))).token}`;
  visitorCookie = `cortex_session=${(await verifyOtp(VISITOR, await otpDe(VISITOR))).token}`;
  project_ = await createProject(`Purge ${RID}`, { ownerEmail: OWNER });
  other = await createProject(`Purge Other ${RID}`, { ownerEmail: OWNER });
  otherEntryId = (
    await saveContext({ content: `The invoices are signed with the vendor's key ${RID}.`, project: other.name, createdBy: OWNER })
  ).entry.id;
}, 120_000);

const get = (path: string, cookie = ownerCookie) => createWebApp().request(path, { headers: { cookie } });

function post(path: string, fields: [string, string][], cookie = ownerCookie) {
  return createWebApp().request(path, {
    method: "POST",
    headers: { cookie, "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams(fields).toString(),
  });
}

const stillThere = async (ids: string[]) =>
  (await Promise.all(ids.map(getEntryDetail))).flatMap((d, i) => (d ? [ids[i]!] : []));

describe("deleting entries in bulk from the Memory screen", () => {
  it("whoever manages the project gets a box on every card, inside a form that posts them", async () => {
    const ids = await seedEntries();
    const html = await (await get(`/p/${project_.slug}`)).text();
    expect(html).toContain(`action="/p/${project_.slug}/purge"`);
    for (const id of ids) expect(html, id).toContain(`name="ids" value="${id}"`);
    expect(html).toContain("Select all visible");
  }, 60_000);

  it("'Select all visible' works without JavaScript: it is a link that ticks every box", async () => {
    const html = await (await get(`/p/${project_.slug}?select=all`)).text();
    const boxes = [...html.matchAll(/<input class="card-pick"[^>]*>/g)].map((m) => m[0]);
    expect(boxes.length).toBeGreaterThan(0);
    expect(boxes.filter((b) => !b.includes("checked"))).toEqual([]);
    expect(html).toContain("Clear selection");
  }, 60_000);

  it("someone who can read the project but not manage it sees no boxes, and a forged post is refused", async () => {
    const ids = await seedEntries();
    const html = await (await get(`/p/${project_.slug}`, visitorCookie)).text();
    expect(html).toContain(project_.name);
    expect(html).not.toContain('name="ids"');

    const res = await post(`/p/${project_.slug}/purge`, [...ids.map((id): [string, string] => ["ids", id]), ["confirm", "1"]], visitorCookie);
    expect(res.status).toBe(403);
    expect(await stillThere(ids)).toEqual(ids);
  }, 60_000);

  it("the first post deletes nothing: it says how many are going and that it cannot be undone", async () => {
    const ids = await seedEntries();
    const res = await post(`/p/${project_.slug}/purge`, ids.map((id) => ["ids", id]));
    expect(res.status).toBe(200);
    const html = await res.text();
    expect(html).toContain(`Purge ${ids.length} entries for good?`);
    expect(html).toContain("cannot be undone");
    expect(html).toContain('name="confirm" value="1"');
    expect(await stillThere(ids)).toEqual(ids);

    const unstyled = [...new Set([...html.matchAll(/class="([^"]+)"/g)].flatMap((m) => m[1]!.split(/\s+/)))].filter(
      (c) => c && !CSS.includes(`.${c}`),
    );
    expect(unstyled).toEqual([]);
  }, 60_000);

  it("confirming purges them and returns to the same filtered, sorted and grouped list, saying how many went", async () => {
    const ids = await seedEntries();
    const res = await post(`/p/${project_.slug}/purge`, [
      ...ids.map((id): [string, string] => ["ids", id]),
      ["status", "pending_validation"],
      ["sort", "updated"],
      ["group", "week"],
      ["confirm", "1"],
    ]);
    expect(res.status).toBe(302);
    const location = res.headers.get("location")!;
    expect(location).toBe(`/p/${project_.slug}?status=pending_validation&sort=updated&group=week&purged=${ids.length}`);
    expect(await stillThere(ids)).toEqual([]);

    const html = await (await get(location)).text();
    expect(html).toContain(`${ids.length} entries purged.`);
    for (const id of ids) expect(html, id).not.toContain(id);
  }, 60_000);

  it("the confirmation only offers what belongs to this project, whatever ids the form carried", async () => {
    const ids = await seedEntries();
    const html = await (await post(`/p/${project_.slug}/purge`, [...ids, otherEntryId].map((id) => ["ids", id]))).text();
    expect(html).toContain(`Purge ${ids.length} entries for good?`);
    expect(html).not.toContain(otherEntryId);
    expect(await stillThere([otherEntryId])).toEqual([otherEntryId]);
  }, 60_000);

  it("posting with nothing ticked goes back to the list instead of failing", async () => {
    const res = await post(`/p/${project_.slug}/purge`, [["type", "decision"]]);
    expect(res.status).toBe(302);
    expect(res.headers.get("location")).toBe(`/p/${project_.slug}?type=decision`);
  });
});

const SUBJECTS = [
  "the retry queue drains in batches of four",
  "staging is reset every Monday at seven",
  "the worker cold start is nine seconds",
  "uploads above ten megabytes are refused",
  "the search index is rebuilt at night",
];
let seeded = 0;
let scopedProjects = 0;

async function freshProject(): Promise<{ project: ProjectRef; child: ProjectRef }> {
  const n = ++scopedProjects;
  const project = await createProject(`Purge Scope ${RID} ${n}`, { ownerEmail: OWNER });
  const child = await createProject(`Purge Scope ${RID} ${n} child`, { ownerEmail: OWNER, parentSlug: project.slug });
  return { project, child };
}

async function addedOn(target: ProjectRef, day: string, type: "decision" | "other" = "decision"): Promise<string> {
  const subject = SUBJECTS[seeded++ % SUBJECTS.length];
  const { entry } = await saveContext(
    { content: `Lab ${RID} ${seeded}: ${subject}. ${Math.random()}`, project: target.name, type, createdBy: OWNER },
    { useClassifier: false },
  );
  await getSql()`UPDATE memos SET created_at = ${new Date(`${day}T12:00:00Z`)} WHERE id = ${entry.id}`;
  return entry.id;
}

const hiddenValue = (html: string, name: string) => html.match(new RegExp(`name="${name}" value="([^"]+)"`))?.[1];

/*
 * ADR-0087: a ticked block or "the whole project" purges memos the form never carried, so the
 * server is what decides which. These pin that it takes the whole block and nothing beyond it,
 * that it follows the list's filters, and that "everything" cannot go without the slug typed back.
 */
describe("purging a whole block or the whole project from the Memory screen", () => {
  it("with the list grouped by date, each heading has a box for the whole block; readers get none", async () => {
    const { project } = await freshProject();
    await addedOn(project, "2026-03-02");
    await addedOn(project, "2026-03-09");

    const html = await (await get(`/p/${project.slug}?sort=created&group=week`)).text();
    expect(html).toContain(`name="blocks" value="week:2026-03-02"`);
    expect(html).toContain(`name="blocks" value="week:2026-03-09"`);
    expect(html).toContain("Purge the whole project…");
    expect(await (await get(`/p/${project.slug}?sort=created&group=week&type=decision`)).text()).toContain(
      "Purge everything matching these filters…",
    );
    expect(await (await get(`/p/${project.slug}?sort=created&group=week`, visitorCookie)).text()).not.toContain('name="blocks"');
  }, 60_000);

  it("a ticked block takes every memo of that day the form did not carry, and only those", async () => {
    const { project } = await freshProject();
    const sameDay = [await addedOn(project, "2026-03-02"), await addedOn(project, "2026-03-02")];
    const nextDay = await addedOn(project, "2026-03-03");
    const block: [string, string][] = [["blocks", "day:2026-03-02"], ["sort", "created"], ["group", "day"]];

    const preview = await post(`/p/${project.slug}/purge`, block);
    expect(preview.status).toBe(200);
    const html = await preview.text();
    expect(html).toContain("Purge 2 entries for good?");
    expect(html).toContain("2 March 2026, whole");
    for (const id of sameDay) expect(html, id).toContain(id);
    expect(html).not.toContain(nextDay);
    expect(html).not.toContain('name="confirmSlug"');

    const res = await post(`/p/${project.slug}/purge`, [...block, ["asOf", hiddenValue(html, "asOf")!], ["confirm", "1"]]);
    expect(res.status).toBe(302);
    expect(res.headers.get("location")).toBe(`/p/${project.slug}?sort=created&group=day&purged=2`);
    expect(await stillThere([...sameDay, nextDay])).toEqual([nextDay]);
  }, 60_000);

  it("a block follows the list's filters: with type=other only that day's `other` memos go", async () => {
    const { project } = await freshProject();
    const decision = await addedOn(project, "2026-03-02");
    const other = await addedOn(project, "2026-03-02", "other");
    const res = await post(`/p/${project.slug}/purge`, [
      ["blocks", "day:2026-03-02"],
      ["type", "other"],
      ["sort", "created"],
      ["group", "day"],
      ["confirm", "1"],
    ]);
    expect(res.status).toBe(302);
    expect(await stillThere([decision, other])).toEqual([decision]);
  }, 60_000);

  it("the whole project goes only with its slug typed back, and its child projects keep theirs", async () => {
    const { project, child } = await freshProject();
    const ids = [await addedOn(project, "2026-01-05"), await addedOn(project, "2026-02-05")];
    const childs = await addedOn(child, "2026-01-05");

    const preview = await post(`/p/${project.slug}/purge`, [["scope", "all"]]);
    expect(preview.status).toBe(200);
    const html = await preview.text();
    expect(html).toContain("Purge 2 entries for good?");
    expect(html).toContain('name="confirmSlug"');
    expect(html).toContain("child projects keep their own entries");
    const unstyled = [...new Set([...html.matchAll(/class="([^"]+)"/g)].flatMap((m) => m[1]!.split(/\s+/)))].filter(
      (c) => c && !CSS.includes(`.${c}`),
    );
    expect(unstyled).toEqual([]);

    const confirm: [string, string][] = [["scope", "all"], ["asOf", hiddenValue(html, "asOf")!], ["confirm", "1"]];
    expect((await post(`/p/${project.slug}/purge`, confirm)).status).toBe(400);
    const wrong = await post(`/p/${project.slug}/purge`, [...confirm, ["confirmSlug", "yes"]]);
    expect(wrong.status).toBe(400);
    expect(await wrong.text()).toContain("not this project's slug");
    expect(await stillThere(ids)).toEqual(ids);

    const res = await post(`/p/${project.slug}/purge`, [...confirm, ["confirmSlug", project.slug!]]);
    expect(res.status).toBe(302);
    expect(res.headers.get("location")).toBe(`/p/${project.slug}?purged=2`);
    expect(await stillThere([...ids, childs])).toEqual([childs]);
  }, 60_000);

  it("a memo written after the confirmation page was opened is left alone", async () => {
    const { project } = await freshProject();
    const seen = await addedOn(project, "2026-01-05");
    const html = await (await post(`/p/${project.slug}/purge`, [["scope", "all"]])).text();
    const late = (await saveContext({ content: `Written meanwhile ${RID} ${Math.random()}`, project: project.name, createdBy: OWNER })).entry.id;

    await post(`/p/${project.slug}/purge`, [
      ["scope", "all"],
      ["asOf", hiddenValue(html, "asOf")!],
      ["confirm", "1"],
      ["confirmSlug", project.slug!],
    ]);
    expect(await stillThere([seen, late])).toEqual([late]);
  }, 60_000);

  it("someone who can read the project cannot purge a block or all of it with a forged post", async () => {
    const { project } = await freshProject();
    const ids = [await addedOn(project, "2026-03-02")];
    const forged: [string, string][][] = [
      [["scope", "all"], ["confirm", "1"], ["confirmSlug", project.slug!]],
      [["blocks", "day:2026-03-02"], ["sort", "created"], ["confirm", "1"]],
    ];
    for (const fields of forged) expect((await post(`/p/${project.slug}/purge`, fields, visitorCookie)).status).toBe(403);
    expect(await stillThere(ids)).toEqual(ids);
  }, 60_000);
});

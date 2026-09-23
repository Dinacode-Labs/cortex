import { describe, it, expect, beforeAll } from "vitest";
import { getSql } from "@cortex/database";
import { createProject, requestOtp, saveContext, verifyOtp, type ProjectRef } from "@cortex/core";
import { createApp as createWebApp } from "../../apps/web/src/app.js";

const RID = Math.random().toString(36).slice(2, 8);
const USER = `date-blocks-${RID}@example.com`;

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

let cookie: string;
let dated: ProjectRef;
let crowded: ProjectRef;

const SUBJECTS = ["queues", "retries", "ledger", "webhooks", "invoices", "tenancy", "exports", "caching"];

async function saveAt(project: ProjectRef, n: number, createdAt: string): Promise<void> {
  const { entry } = await saveContext({
    content: `Entry ${n} ${RID}: we decided on ${SUBJECTS[n % SUBJECTS.length]} with key ${RID}${n}x${n * 7919}.`,
    project: project.name,
    createdBy: USER,
    type: "decision",
  });
  await getSql()`UPDATE context_entries SET created_at = ${createdAt} WHERE id = ${entry.id}`;
}

beforeAll(async () => {
  const { token } = await verifyOtp(USER, await otpDe(USER));
  cookie = `cortex_session=${token}`;

  dated = await createProject(`Dated ${RID}`, { ownerEmail: USER });
  const stamps = [
    "2025-09-24T10:00:00Z",
    "2025-09-24T08:00:00Z",
    "2025-09-22T09:00:00Z",
    "2025-08-15T09:00:00Z",
    "2024-12-31T23:30:00Z",
  ];
  for (const [i, at] of stamps.entries()) await saveAt(dated, i, at);

  crowded = await createProject(`Crowded ${RID}`, { ownerEmail: USER });
  for (let i = 0; i < 62; i++) await saveAt(crowded, i, `2025-09-24T${String(i % 24).padStart(2, "0")}:00:00Z`);
}, 300_000);

const get = async (path: string): Promise<string> => {
  const res = await createWebApp().request(path, { headers: { cookie } });
  expect(res.status, path).toBe(200);
  return res.text();
};
const headings = (html: string): string[] =>
  [...html.matchAll(/<h2 class="date-block-head">([^<]+?) <span class="date-block-count">([^<]+)<\/span>/g)].map(
    (m) => `${m[1]} · ${m[2]}`,
  );

describe("the Memory list in date blocks", () => {
  it("without a date sort there is no grouping to choose and no blocks", async () => {
    const html = await get(`/p/${dated.slug}`);
    expect(html).not.toContain("By week");
    expect(html).not.toContain(`class="date-block"`);
  });

  it("by day, each block is headed with its date and how many entries it holds", async () => {
    expect(headings(await get(`/p/${dated.slug}?sort=created&dir=desc&group=day`))).toEqual([
      "24 September 2025 · 2 entries",
      "22 September 2025 · 1 entry",
      "15 August 2025 · 1 entry",
      "31 December 2024 · 1 entry",
    ]);
  });

  it("a date sort without a grouping shows it by day", async () => {
    expect(headings(await get(`/p/${dated.slug}?sort=created`))[0]).toBe("24 September 2025 · 2 entries");
  });

  it("weeks start on Monday, months and years cut where the calendar does", async () => {
    expect(headings(await get(`/p/${dated.slug}?sort=created&group=week`))).toEqual([
      "Week of 22 September 2025 · 3 entries",
      "Week of 11 August 2025 · 1 entry",
      "Week of 30 December 2024 · 1 entry",
    ]);
    expect(headings(await get(`/p/${dated.slug}?sort=created&group=month`))).toEqual([
      "September 2025 · 3 entries",
      "August 2025 · 1 entry",
      "December 2024 · 1 entry",
    ]);
    expect(headings(await get(`/p/${dated.slug}?sort=created&group=year`))).toEqual([
      "2025 · 4 entries",
      "2024 · 1 entry",
    ]);
  });

  it("oldest first puts the oldest block first", async () => {
    expect(headings(await get(`/p/${dated.slug}?sort=created&dir=asc&group=year`))).toEqual([
      "2024 · 1 entry",
      "2025 · 4 entries",
    ]);
  });

  it("as a list it is one grid with no headings, and the choice is still offered", async () => {
    const html = await get(`/p/${dated.slug}?sort=created&group=list`);
    expect(headings(html)).toEqual([]);
    expect(html).toContain('class="grid"');
    expect(html).toMatch(/class="pill active"[^>]*>List</);
  });

  it("the grouping survives the other filters, and they survive it", async () => {
    const html = await get(`/p/${dated.slug}?sort=created&dir=desc&status=pending_validation&group=month`);
    const typeLink = html.match(/href="([^"]*type=decision[^"]*)"/)?.[1] ?? "";
    expect(typeLink).toContain("group=month");
    expect(typeLink).toContain("sort=created");
    const weekLink = html.match(/href="([^"]*group=week[^"]*)"/)?.[1] ?? "";
    expect(weekLink).toContain("status=pending_validation");
    expect(weekLink).toContain("dir=desc");
  });

  it("a block the page limit cuts says so, and offers the rest", async () => {
    const html = await get(`/p/${crowded.slug}?sort=created&group=day`);
    expect(headings(html)).toEqual(["24 September 2025 · 60 shown, more past the end of the page"]);
    expect(html).toContain("Showing the first 60.");
    const more = html.match(/href="([^"]*limit=120[^"]*)"/)?.[1];
    expect(more).toBeDefined();

    const whole = await get(more!.replaceAll("&amp;", "&"));
    expect(headings(whole)).toEqual(["24 September 2025 · 62 entries"]);
    expect(whole).not.toContain("Showing the first");
  }, 60_000);
});

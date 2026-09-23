import { describe, it, expect, beforeAll } from "vitest";
import { getSql } from "@cortex/database";
import { createProject, listEntries, requestOtp, saveContext, verifyOtp, type EntrySort, type ProjectRef } from "@cortex/core";
import { createApp as createWebApp } from "../../apps/web/src/app.js";

/**
 * Ordering a project's memory by when entries were added or last updated.
 *
 * It exists to clean up a memory that filled itself in two days of captures, so "oldest first"
 * has to mean the oldest in the project. Sorting in memory the 60 rows the page already fetched
 * would silently mean "the oldest of the 60 newest" -- which is why every assertion here uses a
 * limit smaller than the project.
 */
const RID = Math.random().toString(36).slice(2, 8);
const USER = `order-${RID}@example.com`;

async function otpFor(email: string): Promise<string> {
  // Looked for ON THIS EMAIL'S LINE: several integration files intercept `console.log` at once.
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
let project_: ProjectRef;
const titles = { first: `First ${RID}`, second: `Second ${RID}`, third: `Third ${RID}` };

beforeAll(async () => {
  const { token } = await verifyOtp(USER, await otpFor(USER));
  cookie = `cortex_session=${token}`;
  project_ = await createProject(`Order ${RID}`, { ownerEmail: USER });

  const first = await saveContext({
    content: `The billing service retries webhooks with exponential backoff ${RID}.`,
    title: titles.first,
    project: project_.name,
    type: "decision",
    createdBy: USER,
  });
  await saveContext({
    content: `Staging databases are wiped every Sunday night ${RID}.`,
    title: titles.second,
    project: project_.name,
    type: "constraint",
    createdBy: USER,
  });
  await saveContext({
    content: `Mobile releases ship behind a remote feature flag ${RID}.`,
    title: titles.third,
    project: project_.name,
    type: "convention",
    createdBy: USER,
  });
  // Any UPDATE moves updated_at through the trigger: the first one added becomes the last touched.
  await getSql()`UPDATE context_entries SET title = title WHERE id = ${first.entry.id}`;
}, 180_000);

const titlesOf = async (sort: EntrySort, limit = 1) =>
  (await listEntries({ project: project_.name, sort, limit })).map((e) => e.title);

describe("ordering a project's entries (in the query, before the limit)", () => {
  it("without an order it stays newest added first, as before", async () => {
    expect((await listEntries({ project: project_.name, limit: 1 })).map((e) => e.title)).toEqual([titles.third]);
  });

  it("oldest added first reaches past the page, not just the newest rows reversed", async () => {
    expect(await titlesOf({ by: "created", dir: "asc" })).toEqual([titles.first]);
    expect(await titlesOf({ by: "created", dir: "asc" }, 3)).toEqual([titles.first, titles.second, titles.third]);
  });

  it("by update date, an old entry touched later comes first, and last in ascending order", async () => {
    expect(await titlesOf({ by: "updated", dir: "desc" })).toEqual([titles.first]);
    expect(await titlesOf({ by: "updated", dir: "asc" }, 3)).toEqual([titles.second, titles.third, titles.first]);
  });
});

describe("the memory page's order selector", () => {
  const page = async (qs: string) =>
    (await createWebApp().request(`/p/${project_.slug}${qs}`, { headers: { cookie } })).text();
  const cardOrder = (html: string) =>
    [titles.first, titles.second, titles.third]
      .map((t) => ({ t, at: html.indexOf(t) }))
      .filter((x) => x.at >= 0)
      .sort((a, b) => a.at - b.at)
      .map((x) => x.t);

  it("lists the cards in the order the URL asks for", async () => {
    expect(cardOrder(await page(""))).toEqual([titles.third, titles.second, titles.first]);
    expect(cardOrder(await page("?sort=created&dir=asc"))).toEqual([titles.first, titles.second, titles.third]);
    expect(cardOrder(await page("?sort=updated&dir=desc"))).toEqual([titles.first, titles.third, titles.second]);
  });

  it("each card says the date it is ordered by", async () => {
    expect(await page("")).toMatch(/class="card-date">Added <time/);
    expect(await page("?sort=updated")).toMatch(/class="card-date">Updated <time/);
  });

  it("changing the type or status keeps the order, and changing the order keeps the filters", async () => {
    const html = await page("?sort=updated&dir=asc&type=decision&status=pending_validation");
    const hrefs = [...html.matchAll(/class="pill[^"]*" href="([^"]+)"/g)].map((m) => m[1]!.replaceAll("&amp;", "&"));
    const lost = hrefs.filter((h) => {
      const qs = new URL(h, "http://x").searchParams;
      const keepsOrder = qs.get("sort") !== null && qs.get("dir") !== null;
      const keepsFilters = qs.has("type") || qs.has("status");
      return !keepsOrder || !keepsFilters;
    });
    expect(lost).toEqual([]);
    expect(html).toMatch(/class="pill active" href="[^"]*sort=updated&amp;dir=asc[^"]*">Least recently updated/);
  });

  it("an unknown order falls back to the default instead of failing", async () => {
    expect(cardOrder(await page("?sort=bogus&dir=sideways"))).toEqual([titles.third, titles.second, titles.first]);
  });
});

import { describe, it, expect, beforeAll, afterEach } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import {
  configureCore,
  createProject,
  getEntryDetail,
  lintProject,
  relateEntries,
  requestOtp,
  resetCore,
  saveContext,
  verifyOtp,
  type CorePorts,
  type ProjectRef,
} from "@cortex/core";
import { createApp as createWebApp } from "../../apps/web/src/app.js";

/**
 * ADR-0092: settling a clash meant opening two pages and judging each, so the lint's advice was
 * never followed. Now it is settled where Health shows it, by the project's team and nobody else.
 */
const RID = Math.random().toString(36).slice(2, 8);
const OWNER = `health-owner-${RID}@example.com`;
const OUTSIDER = `health-outsider-${RID}@example.com`;

async function cookieFor(email: string): Promise<string> {
  // The `log` sender prints the code on a line with the email: it is looked for on THAT line,
  // or another file's code is taken and the login fails somewhere unrelated.
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
let outsiderCookie: string;

beforeAll(async () => {
  ownerCookie = await cookieFor(OWNER);
  outsiderCookie = await cookieFor(OUTSIDER);
}, 120_000);

afterEach(() => resetCore());

const save = async (project: ProjectRef, content: string) =>
  (await saveContext({ content, project: project.name, type: "decision", createdBy: OWNER }, { useClassifier: false })).entry.id;

async function clash(label: string): Promise<{ project: ProjectRef; cloud: string; onPrem: string }> {
  const project = await createProject(`Health ${label} ${RID}`, { ownerEmail: OWNER, visibility: "public" });
  const cloud = await save(project, `The portal ${label} ${RID} is deployed to a public cloud.`);
  const onPrem = await save(project, `The portal ${label} ${RID} must run on the client's own servers.`);
  return { project, cloud, onPrem };
}

const settle = (project: ProjectRef, keep: string, retire: string, cookie = ownerCookie) =>
  createWebApp().request(`/p/${project.slug}/health/settle`, {
    method: "POST",
    headers: { cookie, "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ keep, retire }).toString(),
  });

const statusOf = async (id: string) => (await getEntryDetail(id))!.entry.status;

describe("settling a clash from Health", () => {
  it("keeps one memo, verified, and retires the other as obsolete, each verdict recorded", async () => {
    const { project, cloud, onPrem } = await clash("settle");

    const res = await settle(project, onPrem, cloud);
    expect(res.status).toBe(302);
    expect(res.headers.get("location")).toBe(`/p/${project.slug}/health?settled=1`);

    const kept = (await getEntryDetail(onPrem))!;
    expect([kept.entry.status, kept.entry.confidence]).toEqual(["validated", "verified"]);
    expect(kept.reviews.map((r) => [r.verdict, r.channel, r.reviewedBy])).toEqual([["validated", "web", OWNER]]);
    const retired = (await getEntryDetail(cloud))!;
    expect(retired.entry.status).toBe("obsolete");
    expect(retired.reviews.map((r) => r.verdict)).toEqual(["obsolete"]);
  }, 60_000);

  /*
   * The finding has to go, or the button lies: the lint counted a retired memo as current, so the
   * clash stayed on the page after settling it.
   */
  it("takes the clash out of Health once it is settled", async () => {
    const { project, cloud, onPrem } = await clash("gone");
    await relateEntries(cloud, onPrem, "contradicts");
    const older = await save(project, "The retry backoff is exponential, capped at 60 seconds, with jitter.");
    const newer = await save(project, "The retry backoff is exponential, capped at 60 seconds, with random jitter to avoid synchronisation.");
    const involves = (id: string) => (f: { aId: string | null; bId: string | null }) => f.aId === id || f.bId === id;

    const before = await lintProject(project.name);
    expect(before.contradictions.some(involves(cloud))).toBe(true);
    expect(before.duplicates.some(involves(older))).toBe(true);

    await settle(project, onPrem, cloud);
    await settle(project, newer, older);

    const after = await lintProject(project.name);
    expect(after.contradictions.filter(involves(cloud))).toEqual([]);
    expect(after.duplicates.filter(involves(older))).toEqual([]);
  }, 60_000);

  it("is refused to whoever can read the project but not judge it", async () => {
    const { project, cloud, onPrem } = await clash("outsider");

    expect((await settle(project, onPrem, cloud, outsiderCookie)).status).toBe(403);
    expect([await statusOf(onPrem), await statusOf(cloud)]).toEqual(["pending_validation", "pending_validation"]);
  }, 60_000);

  it("never reaches a memo of another project through a forged form", async () => {
    const { project, onPrem } = await clash("here");
    const elsewhere = await clash("elsewhere");

    await settle(project, onPrem, elsewhere.cloud);
    expect([await statusOf(onPrem), await statusOf(elsewhere.cloud)]).toEqual(["pending_validation", "pending_validation"]);
  }, 60_000);

  it("is offered on both sides of every clash, to the team only", async () => {
    const { project, cloud, onPrem } = await clash("offer");
    const nothing = async () => [];
    configureCore({
      health: {
        currentCount: async () => 2,
        contradictions: async () => [{ a: "Public cloud", b: "Own servers", aId: cloud, bId: onPrem }],
        likelyDuplicates: nothing,
        orphanEntities: nothing,
        lowConfidenceCount: async () => 0,
        historicalCount: async () => 0,
        neverReviewedCount: async () => 2,
        incidentGaps: nothing,
      } as unknown as CorePorts["health"],
    });

    const page = (cookie: string) =>
      createWebApp().request(`/p/${project.slug}/health`, { headers: { cookie } }).then((r) => r.text());
    const forms = (html: string) =>
      [...html.matchAll(/name="keep" value="([^"]+)">\s*<input type="hidden" name="retire" value="([^"]+)"/g)].map((m) => `${m[1]}>${m[2]}`);

    const html = await page(ownerCookie);
    expect(forms(html).sort()).toEqual([`${cloud}>${onPrem}`, `${onPrem}>${cloud}`].sort());
    expect(forms(await page(outsiderCookie))).toEqual([]);

    // web-styles.test.ts sees a project with no clash; this page is the one that paints a pair.
    const css = readFileSync(resolve(import.meta.dirname, "../../apps/web/public/styles.css"), "utf8");
    const classes = new Set([...html.matchAll(/class="([^"]+)"/g)].flatMap((m) => m[1]!.split(/\s+/).filter(Boolean)));
    expect([...classes].filter((c) => !css.includes(`.${c}`))).toEqual([]);
  }, 60_000);
});

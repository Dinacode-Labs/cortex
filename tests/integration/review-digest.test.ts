import { describe, it, expect, beforeAll, afterEach } from "vitest";
import {
  addProjectMember,
  configureCore,
  createProject,
  requestOtp,
  resetCore,
  reviewDigestOn,
  saveContext,
  sendReviewDigests,
  setReviewDigest,
  verifyOtp,
  type EmailMessage,
  type EmailSender,
  type ProjectRef,
} from "@cortex/core";
import { createApp as createWebApp } from "../../apps/web/src/app.js";

const RID = Math.random().toString(36).slice(2, 8);
const OWNER = `digest-owner-${RID}@example.com`;
const CLIENT_MEMBER = `digest-client-${RID}@example.com`;
const OUTSIDER = `digest-outsider-${RID}@example.com`;
const OURS = [OWNER, CLIENT_MEMBER, OUTSIDER];

// Each pair scores ~0.86 with the tests' local embeddings: the older memo of each comes up for review.
const BACKOFF = [
  `The retry backoff is exponential, capped at 60 seconds, with jitter ${RID}.`,
  `The retry backoff is exponential, capped at 60 seconds, with random jitter to avoid synchronisation ${RID}.`,
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

function inbox(failFor: string[] = []): EmailSender & { sent: EmailMessage[] } {
  const sent: EmailMessage[] = [];
  return {
    name: "test",
    sent,
    async send(message) {
      if (failFor.includes(message.to)) throw new Error("the SMTP relay said no");
      sent.push(message);
    },
  };
}

/** The test database holds every other file's projects too: only this file's people count. */
async function digestRun(sender = inbox()): Promise<EmailMessage[]> {
  configureCore({ email: sender });
  await sendReviewDigests();
  return sender.sent.filter((m) => OURS.includes(m.to)).sort((a, b) => a.to.localeCompare(b.to));
}

async function waitForReview(project: ProjectRef, contents: readonly string[]): Promise<void> {
  for (const content of contents) {
    await saveContext({ content, project: project.name, type: "decision", createdBy: OWNER }, { useClassifier: false });
  }
}

const web = (path: string, init: RequestInit = {}) => createWebApp().request(path, init);
const post = (path: string, fields: Record<string, string> = {}, cookie = "") =>
  web(path, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded", ...(cookie ? { cookie } : {}) },
    body: new URLSearchParams(fields).toString(),
  });
const unsubscribePath = (email: EmailMessage, project: ProjectRef): string =>
  new URL(email.text.match(new RegExp(`Turn it off for ${project.name}: (\\S+)`))![1]!).pathname;

let client: ProjectRef;
let repo: ProjectRef;
let sibling: ProjectRef;
let clientMemberCookie: string;
let outsiderCookie: string;

beforeAll(async () => {
  await cookieFor(OWNER);
  clientMemberCookie = await cookieFor(CLIENT_MEMBER);
  outsiderCookie = await cookieFor(OUTSIDER);
  client = await createProject(`Digest client ${RID}`, { ownerEmail: OWNER });
  repo = await createProject(`Digest repo ${RID}`, { ownerEmail: OWNER, parentSlug: client.slug });
  sibling = await createProject(`Digest sibling ${RID}`, { ownerEmail: OWNER, parentSlug: client.slug });
  await addProjectMember(client.slug!, CLIENT_MEMBER, { email: OWNER });
  await waitForReview(repo, BACKOFF);
}, 120_000);

afterEach(() => resetCore());

/*
 * The Review queue only filled: the count lived inside a UI people open when they already mean
 * to, and nothing told the people who can clear it that something new was waiting. Who hears
 * about it is each person's choice, project by project (ADR-0097). The tests below run in order,
 * each on the state the one before left.
 */
describe("the review digest", () => {
  it("is off by default: memos waiting mail nobody", async () => {
    expect(await digestRun()).toEqual([]);
  });

  /* Settings was for managers only, so a member who can clear Review never saw the switch. */
  it("a member who does not manage the project finds the switch in its Settings", async () => {
    const page = await (await web(`/p/${repo.slug}/settings`, { headers: { cookie: clientMemberCookie } })).text();
    expect(page).toContain(`href="/p/${repo.slug}/settings"`);
    expect(page).toContain("Your notifications");
    expect(page).toContain(`action="/p/${repo.slug}/settings/review-digest"`);

    const saved = await post(`/p/${repo.slug}/settings/review-digest`, { on: "1" }, clientMemberCookie);
    expect(saved.headers.get("location")).toBe(`/p/${repo.slug}/settings`);
    expect(await reviewDigestOn({ email: CLIENT_MEMBER }, repo)).toBe(true);
    expect(await (await web(`/p/${repo.slug}/settings`, { headers: { cookie: clientMemberCookie } })).text()).toMatch(/name="on" value="1"\s+checked/);
  });

  /* Reading a public project is open to anyone signed in; hearing about its Review is for its team. */
  it("someone off the team can read the project but cannot switch it on", async () => {
    expect(await (await web(`/p/${repo.slug}/settings`, { headers: { cookie: outsiderCookie } })).text()).not.toContain("Your notifications");

    await post(`/p/${repo.slug}/settings/review-digest`, { on: "1" }, outsiderCookie);

    expect(await reviewDigestOn({ email: OUTSIDER }, repo)).toBe(false);
  });

  it("what waited before it was switched on is not news", async () => {
    await setReviewDigest({ email: OWNER }, repo, true);
    expect(await digestRun()).toEqual([]);
  });

  it("reaches whoever switched the project on once something new waits there, and carries no memo text", async () => {
    await waitForReview(repo, DEPLOYS);
    const sent = await digestRun();

    expect(sent.map((m) => m.to)).toEqual([CLIENT_MEMBER, OWNER].sort());
    for (const email of sent) {
      expect(email.text).toContain(`/p/${repo.slug}/review`);
      expect(email.text).toMatch(/\d+ waiting, \d+ new/);
      for (const content of [...BACKOFF, ...DEPLOYS]) {
        expect(email.text).not.toContain(content);
        expect(email.html).not.toContain(content);
      }
    }
  });

  it("goes again only when something new came up", async () => {
    expect(await digestRun()).toEqual([]);
  });

  it("a project nobody switched on mails nobody, not even its owner", async () => {
    await waitForReview(sibling, BACKOFF);
    expect(await digestRun()).toEqual([]);
  });

  /* An email that never left counted as sent, and that person heard nothing until the next memo. */
  it("an email that could not be sent is tried on the next run", async () => {
    await waitForReview(repo, BACKOFF.map((m) => `${m} Again.`));
    const failed = await digestRun(inbox([CLIENT_MEMBER]));
    expect(failed.map((m) => m.to)).toEqual([OWNER]);

    expect((await digestRun()).map((m) => m.to)).toEqual([CLIENT_MEMBER]);
  });

  /* A mail scanner opens every link in an email: on the GET, people would be unsubscribed unseen. */
  it("each project's link asks first, and its button turns off that project only", async () => {
    await setReviewDigest({ email: OWNER }, sibling, true);
    await waitForReview(repo, DEPLOYS.map((m) => `${m} ${RID}`));
    await waitForReview(sibling, DEPLOYS.map((m) => `${m} ${RID}`));
    const ownersEmail = (await digestRun()).find((m) => m.to === OWNER)!;
    const path = unsubscribePath(ownersEmail, repo);

    const asked = await web(path);
    expect(asked.status).toBe(200);
    expect(await asked.text()).toContain(repo.name);
    expect(await reviewDigestOn({ email: OWNER }, repo)).toBe(true);

    expect((await post(path)).status).toBe(200);
    expect(await reviewDigestOn({ email: OWNER }, repo)).toBe(false);
    expect(await reviewDigestOn({ email: OWNER }, sibling)).toBe(true);
  });

  it("a link nobody issued turns nothing off", async () => {
    expect((await web("/unsubscribe/not-a-token")).status).toBe(404);
    expect((await post("/unsubscribe/not-a-token")).status).toBe(404);
  });

  it("unchecking the box in Settings turns it off", async () => {
    await post(`/p/${repo.slug}/settings/review-digest`, {}, clientMemberCookie);
    expect(await reviewDigestOn({ email: CLIENT_MEMBER }, repo)).toBe(false);
  });
});

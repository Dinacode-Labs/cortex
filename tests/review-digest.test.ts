import { describe, it, expect, afterEach } from "vitest";
import { configureCore, NotAReviewerError, resetCore, sendReviewDigests, setReviewDigest, type EmailMessage, type EmailSender } from "../packages/core/src/index";
import { composeReviewDigest, digestFor, type DigestLine } from "../packages/core/src/notifications/domain/review-digest";
import type { DigestSubscriber, DigestSubscriptions } from "../packages/core/src/notifications/domain/digest-subscriptions";
import type { ProjectRepository } from "../packages/core/src/projects/domain/project-repository";
import type { QueuedMemo, ReviewQueue } from "../packages/core/src/knowledge/domain/review-queue";
import type { VerificationQueue } from "../packages/core/src/knowledge/domain/verification-queue";

const SWITCHED_ON = new Date("2026-10-10T09:00:00Z");
const YESTERDAY = new Date("2026-10-15T09:00:00Z");
const queuedAt = (iso: string): QueuedMemo => ({ memoId: iso, lastQueuedAt: new Date(iso) });
const waiting = (name: string, queued: QueuedMemo[], subscribedAt = SWITCHED_ON) => ({
  projectId: `id-${name}`,
  name,
  slug: name.toLowerCase(),
  subscribedAt,
  queued,
});
const LINKS = { webUrl: "https://memory.example.com", unsubscribeUrl: (line: DigestLine) => `https://memory.example.com/unsubscribe/off-${line.slug}` };

/*
 * A digest that repeats yesterday's number every morning teaches people to ignore it, and then
 * they ignore the morning something new did arrive. And switching a busy project on must not
 * mail its whole backlog as news the next morning (ADR-0097).
 */
describe("what a person is told", () => {
  it("nothing, when nothing came up since their previous digest", () => {
    expect(digestFor([waiting("Billing", [queuedAt("2026-10-14T10:00:00Z")])], YESTERDAY)).toBeNull();
  });

  it("nothing, when all that waits was already there when they switched the project on", () => {
    const project = waiting("Billing", [queuedAt("2026-10-14T10:00:00Z")], new Date("2026-10-16T08:00:00Z"));
    expect(digestFor([project], null)).toBeNull();
  });

  it("on their first digest, only what came in after they switched the project on is new", () => {
    const project = waiting("Billing", [queuedAt("2026-10-09T10:00:00Z"), queuedAt("2026-10-14T10:00:00Z")]);
    expect(digestFor([project], null)).toEqual([{ projectId: "id-Billing", name: "Billing", slug: "billing", waiting: 2, newSinceLastDigest: 1 }]);
  });

  it("once something is new, every project with memos waiting, the newest first", () => {
    const projects = [
      waiting("Billing", [queuedAt("2026-10-14T10:00:00Z"), queuedAt("2026-10-14T11:00:00Z")]),
      waiting("Search", [queuedAt("2026-10-16T08:00:00Z")]),
    ];
    expect(digestFor(projects, YESTERDAY)).toEqual([
      { projectId: "id-Search", name: "Search", slug: "search", waiting: 1, newSinceLastDigest: 1 },
      { projectId: "id-Billing", name: "Billing", slug: "billing", waiting: 2, newSinceLastDigest: 0 },
    ]);
  });
});

/*
 * A project name is typed by a person and lands in an HTML email; and a memo can hold what a
 * person would not forward, while an email gets forwarded (ADR-0097).
 */
describe("the digest email", () => {
  const lines: DigestLine[] = [{ projectId: "p1", name: `<img src=x onerror="alert(1)"> & Co`, slug: "acme-co", waiting: 3, newSinceLastDigest: 2 }];

  it("escapes what a person typed", () => {
    const email = composeReviewDigest("dev@example.com", lines, "Memory", LINKS);
    expect(email.html).not.toContain("<img");
    expect(email.html).toContain("&lt;img src=x onerror=&quot;alert(1)&quot;&gt; &amp; Co");
  });

  it("says where and how many, and links each project's Review and its own way out", () => {
    const email = composeReviewDigest("dev@example.com", lines, "Memory", LINKS);
    expect(email.subject).toBe("2 new memos to review in Memory");
    for (const body of [email.text, email.html]) {
      expect(body).toContain("https://memory.example.com/p/acme-co/review");
      expect(body).toContain("3 waiting, 2 new");
      expect(body).toContain("https://memory.example.com/unsubscribe/off-acme-co");
    }
  });
});

class MemorySubscriptions implements DigestSubscriptions {
  readonly lastSent = new Map<string, Date | null>();
  readonly switchedOn = new Map<string, Set<string>>();
  constructor(switchedOn: Record<string, string[]>) {
    for (const [email, projectIds] of Object.entries(switchedOn)) this.switchedOn.set(email, new Set(projectIds));
  }
  async subscribers(): Promise<DigestSubscriber[]> {
    return [...this.switchedOn]
      .filter(([, projectIds]) => projectIds.size > 0)
      .map(([email, projectIds]) => ({
        email,
        lastSentAt: this.lastSent.get(email) ?? null,
        projects: [...projectIds].map((projectId) => ({ projectId, subscribedAt: SWITCHED_ON })),
      }));
  }
  async claim(email: string, previous: Date | null): Promise<boolean> {
    if ((this.lastSent.get(email) ?? null)?.getTime() !== previous?.getTime()) return false;
    this.lastSent.set(email, new Date());
    return true;
  }
  async release(email: string, previous: Date | null): Promise<void> {
    this.lastSent.set(email, previous);
  }
  async isSubscribed(email: string, projectId: string): Promise<boolean> {
    return this.switchedOn.get(email)?.has(projectId) ?? false;
  }
  async subscribe(email: string, projectId: string): Promise<void> {
    this.switchedOn.set(email, (this.switchedOn.get(email) ?? new Set()).add(projectId));
  }
  async unsubscribe(email: string, projectId: string): Promise<void> {
    this.switchedOn.get(email)?.delete(projectId);
  }
  async issueUnsubscribeToken(): Promise<void> {}
  async unsubscribeTarget(): Promise<null> {
    return null;
  }
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

const NEW_MEMO = queuedAt("2026-10-16T08:00:00Z");
const ANOTHER_NEW_MEMO = queuedAt("2026-10-16T08:30:00Z");

/** Billing and Search, both private, each with one memo waiting in the older lane. */
function twoProjects(team: Record<"billing" | "search", string[]>, unchecked: Map<string, QueuedMemo[]> = new Map()): void {
  const refs = [
    { id: "billing", name: "Billing", slug: "billing", visibility: "private", ownerEmail: null, parentId: null },
    { id: "search", name: "Search", slug: "search", visibility: "private", ownerEmail: null, parentId: null },
  ] as const;
  configureCore({
    projects: {
      findByIds: async (ids: string[]) => refs.filter((p) => ids.includes(p.id)),
      chain: async (id: string) => [{ id, visibility: "private", ownerEmail: null }],
      isMember: async (projectId: "billing" | "search", email: string) => team[projectId].includes(email),
    } as unknown as ProjectRepository,
    reviewQueue: {
      queuedMemos: async () => new Map([["billing", [NEW_MEMO]], ["search", [NEW_MEMO]]]),
    } as unknown as ReviewQueue,
    verificationQueue: { queuedMemos: async () => unchecked } as unknown as VerificationQueue,
  });
}

const sentTo = (mail: { sent: EmailMessage[] }): string[] => mail.sent.map((m) => m.to);

describe("sending the digests", () => {
  afterEach(() => resetCore());

  it("nobody gets one until they switch a project on", async () => {
    const mail = inbox();
    twoProjects({ billing: ["dev@example.com"], search: ["dev@example.com"] });
    configureCore({ digestSubscriptions: new MemorySubscriptions({}), email: mail });

    await sendReviewDigests();

    expect(mail.sent).toEqual([]);
  });

  it("a person hears about the projects they switched on, and not the others they are on", async () => {
    const mail = inbox();
    twoProjects({ billing: ["dev@example.com"], search: ["dev@example.com"] });
    configureCore({ digestSubscriptions: new MemorySubscriptions({ "dev@example.com": ["billing"] }), email: mail });

    await sendReviewDigests();

    expect(sentTo(mail)).toEqual(["dev@example.com"]);
    expect(mail.sent[0]!.text).toContain("/p/billing/review");
    expect(mail.sent[0]!.text).not.toContain("Search");
  });

  /* The web adds both lanes up in its counts; an email counting one would contradict it. */
  it("counts both lanes of Review, as the web does", async () => {
    const mail = inbox();
    twoProjects({ billing: ["dev@example.com"], search: [] }, new Map([["billing", [ANOTHER_NEW_MEMO]]]));
    configureCore({ digestSubscriptions: new MemorySubscriptions({ "dev@example.com": ["billing"] }), email: mail });

    await sendReviewDigests();

    expect(mail.sent[0]!.text).toContain("Billing: 2 waiting, 2 new");
  });

  /* A switch outlived the access it was given with, and a former member kept hearing about the project. */
  it("whoever left the team stops getting it, and their switch goes with them", async () => {
    const mail = inbox();
    const subscriptions = new MemorySubscriptions({ "gone@example.com": ["billing"] });
    twoProjects({ billing: [], search: [] });
    configureCore({ digestSubscriptions: subscriptions, email: mail });

    await sendReviewDigests();

    expect(mail.sent).toEqual([]);
    expect(await subscriptions.isSubscribed("gone@example.com", "billing")).toBe(false);
  });

  /* Without the claim, a second worker -- or a hand-run `review-digest` -- mails everyone twice. */
  it("two runs over the same queue send each person one email", async () => {
    const mail = inbox();
    twoProjects({ billing: ["owner@example.com"], search: [] });
    configureCore({ digestSubscriptions: new MemorySubscriptions({ "owner@example.com": ["billing"] }), email: mail });

    await Promise.all([sendReviewDigests(), sendReviewDigests()]);

    expect(sentTo(mail)).toEqual(["owner@example.com"]);
  });

  /* An email that never left must not count as sent, or that person waits for the next new memo. */
  it("an email that failed is tried again on the next run, and the others still go", async () => {
    const subscriptions = new MemorySubscriptions({ "owner@example.com": ["billing"], "member@example.com": ["billing"] });
    twoProjects({ billing: ["owner@example.com", "member@example.com"], search: [] });
    configureCore({ digestSubscriptions: subscriptions, email: inbox(["member@example.com"]) });

    const first = await sendReviewDigests();
    expect(first.sent).toEqual(["owner@example.com"]);
    expect(first.failed.map((f) => f.email)).toEqual(["member@example.com"]);

    const mail = inbox();
    configureCore({ email: mail });
    await sendReviewDigests();
    expect(sentTo(mail)).toEqual(["member@example.com"]);
  });

  it("a dry run shows what would go and neither sends nor records it", async () => {
    const mail = inbox();
    const subscriptions = new MemorySubscriptions({ "owner@example.com": ["billing"] });
    twoProjects({ billing: ["owner@example.com"], search: [] });
    configureCore({ digestSubscriptions: subscriptions, email: mail });

    const run = await sendReviewDigests({ dryRun: true });

    expect(run.previews.map((m) => m.to)).toEqual(["owner@example.com"]);
    expect(mail.sent).toEqual([]);
    expect(subscriptions.lastSent.get("owner@example.com")).toBeUndefined();
  });
});

describe("switching it on", () => {
  afterEach(() => resetCore());

  /* Reading a public project is open to anyone signed in; hearing about its Review is for its team. */
  it("only the project's team can switch it on, and anyone can switch it off", async () => {
    const subscriptions = new MemorySubscriptions({ "outsider@example.com": ["billing"] });
    twoProjects({ billing: ["dev@example.com"], search: [] });
    configureCore({ digestSubscriptions: subscriptions });
    const billing = { id: "billing", name: "Billing" };

    await expect(setReviewDigest({ email: "outsider@example.com" }, { id: "search", name: "Search" }, true)).rejects.toBeInstanceOf(NotAReviewerError);
    await setReviewDigest({ email: "outsider@example.com" }, billing, false);
    await setReviewDigest({ email: "dev@example.com" }, billing, true);

    expect(await subscriptions.isSubscribed("outsider@example.com", "billing")).toBe(false);
    expect(await subscriptions.isSubscribed("dev@example.com", "billing")).toBe(true);
  });
});

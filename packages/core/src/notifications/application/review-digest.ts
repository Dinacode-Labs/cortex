import { randomBytes } from "node:crypto";
import { getBrandName, getEnv } from "@cortex/shared";
import { port } from "../../composition.js";
import { hashSecret, normalizeEmail } from "../../auth/domain/auth.js";
import type { EmailMessage } from "../../auth/domain/email.js";
import type { SessionUser } from "../../auth/domain/session-user.js";
import type { QueuedMemo } from "../../knowledge/domain/review-queue.js";
import type { ProjectRef } from "../../projects/domain/project.js";
import { canReviewProject, NotAReviewerError } from "../../projects/application/projects.js";
import { composeReviewDigest, digestFor, UNSUBSCRIBE_TTL_DAYS, type DigestLine, type WaitingProject } from "../domain/review-digest.js";
import type { DigestSubscriber } from "../domain/digest-subscriptions.js";

export interface DigestRun {
  sent: string[];
  failed: { email: string; error: string }[];
  previews: EmailMessage[];
}

const webUrl = (): string => getEnv("CORTEX_WEB_URL", "http://localhost:8080").trim().replace(/\/+$/, "");

function compose(email: string, lines: DigestLine[], unsubscribeTokens: Map<string, string>): EmailMessage {
  const base = webUrl();
  return composeReviewDigest(email, lines, getBrandName(), {
    webUrl: base,
    unsubscribeUrl: (line) => `${base}/unsubscribe/${unsubscribeTokens.get(line.projectId)}`,
  });
}

/** Both lanes of Review (ADR-0091, ADR-0093), as the counts on the web add them up. */
async function queuedByProject(projectIds: string[]): Promise<Map<string, QueuedMemo[]>> {
  const [older, unchecked] = await Promise.all([
    port("reviewQueue").queuedMemos(projectIds),
    port("verificationQueue").queuedMemos(projectIds),
  ]);
  const queued = new Map(older);
  for (const [projectId, memos] of unchecked) queued.set(projectId, [...(queued.get(projectId) ?? []), ...memos]);
  return queued;
}

interface Context {
  projects: Map<string, ProjectRef>;
  queued: Map<string, QueuedMemo[]>;
  dryRun: boolean;
}

// Access is checked again on every run: whoever was removed from the team since switching a
// project on stops getting it, and the switch goes with them.
async function waitingProjectsOf(subscriber: DigestSubscriber, ctx: Context): Promise<WaitingProject[]> {
  const waiting: WaitingProject[] = [];
  for (const { projectId, subscribedAt } of subscriber.projects) {
    const project = ctx.projects.get(projectId);
    if (!project?.slug) continue;
    if (!(await canReviewProject(project, { email: subscriber.email }))) {
      if (!ctx.dryRun) await port("digestSubscriptions").unsubscribe(subscriber.email, projectId);
      continue;
    }
    waiting.push({ projectId, name: project.name, slug: project.slug, subscribedAt, queued: ctx.queued.get(projectId) ?? [] });
  }
  return waiting;
}

async function issueUnsubscribeTokens(email: string, lines: DigestLine[]): Promise<Map<string, string>> {
  const tokens = new Map<string, string>();
  for (const { projectId } of lines) {
    const token = randomBytes(24).toString("base64url");
    await port("digestSubscriptions").issueUnsubscribeToken({ email, projectId }, hashSecret(token), UNSUBSCRIBE_TTL_DAYS);
    tokens.set(projectId, token);
  }
  return tokens;
}

export async function sendReviewDigests(opts: { dryRun?: boolean } = {}): Promise<DigestRun> {
  const run: DigestRun = { sent: [], failed: [], previews: [] };
  const subscriptions = port("digestSubscriptions");
  const subscribers = await subscriptions.subscribers();
  const projectIds = [...new Set(subscribers.flatMap((s) => s.projects.map((p) => p.projectId)))];
  const ctx: Context = {
    projects: new Map((await port("projects").findByIds(projectIds)).map((p) => [p.id, p])),
    queued: await queuedByProject(projectIds),
    dryRun: opts.dryRun ?? false,
  };
  for (const subscriber of subscribers) {
    const lines = digestFor(await waitingProjectsOf(subscriber, ctx), subscriber.lastSentAt);
    if (!lines) continue;
    if (ctx.dryRun) {
      run.previews.push(compose(subscriber.email, lines, new Map(lines.map((line) => [line.projectId, "TOKEN"]))));
      continue;
    }
    // Claimed before sending: a crash in between costs this person one digest, where claiming
    // after would let two runs both send it.
    if (!(await subscriptions.claim(subscriber.email, subscriber.lastSentAt))) continue;
    try {
      const tokens = await issueUnsubscribeTokens(subscriber.email, lines);
      await port("email").send(compose(subscriber.email, lines, tokens));
      run.sent.push(subscriber.email);
    } catch (e) {
      await subscriptions.release(subscriber.email, subscriber.lastSentAt);
      run.failed.push({ email: subscriber.email, error: (e as Error).message });
    }
  }
  return run;
}

export async function reviewDigestOn(viewer: SessionUser, project: Pick<ProjectRef, "id">): Promise<boolean> {
  return port("digestSubscriptions").isSubscribed(normalizeEmail(viewer.email), project.id);
}

/** Only who can clear a project's Review may ask to hear about it (ADR-0097). */
export async function setReviewDigest(viewer: SessionUser, project: Pick<ProjectRef, "id" | "name">, on: boolean): Promise<void> {
  const email = normalizeEmail(viewer.email);
  if (!on) return port("digestSubscriptions").unsubscribe(email, project.id);
  if (!(await canReviewProject(project, viewer))) throw new NotAReviewerError(project.name);
  await port("digestSubscriptions").subscribe(email, project.id);
}

export interface UnsubscribeLink {
  email: string;
  project: ProjectRef;
}

export async function unsubscribeLink(token: string): Promise<UnsubscribeLink | null> {
  const target = await port("digestSubscriptions").unsubscribeTarget(hashSecret(token));
  if (!target) return null;
  const [project] = await port("projects").findByIds([target.projectId]);
  return project ? { email: target.email, project } : null;
}

export async function unsubscribeWithToken(token: string): Promise<UnsubscribeLink | null> {
  const link = await unsubscribeLink(token);
  if (link) await port("digestSubscriptions").unsubscribe(link.email, link.project.id);
  return link;
}

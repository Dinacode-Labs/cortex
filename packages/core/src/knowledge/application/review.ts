import { port } from "../../composition.js";
import type { SessionUser } from "../../auth/domain/session-user.js";
import { canReviewProject, NotAReviewerError } from "../../projects/application/projects.js";
import type { ProjectRef } from "../../projects/domain/project.js";
import type { Memo } from "../domain/memo.js";
import { confidenceAfterReview, type Reviewer, type ReviewVerdict } from "../domain/review.js";
import type { ReviewDecision, ReviewResolution } from "../domain/review-queue.js";
import { updateEntryFields } from "./dedup.js";

export async function validateEntry(id: string, verdict: ReviewVerdict, reviewer: Reviewer): Promise<Memo | null> {
  return port("memos").review(id, { verdict, reviewer, confidence: confidenceAfterReview(verdict, reviewer.channel) });
}

const RESOLUTION: Record<Exclude<ReviewDecision, "skip">, ReviewResolution> = { keep: "kept", discard: "discarded", modify: "modified" };

/**
 * A decision in the Review section, always from the web: keeping or rewriting a memo is a person
 * vouching for it (ADR-0090), discarding it says it held once and no longer does. A decision on a
 * memo that is no longer waiting -- a second click, a stale tab -- does nothing.
 */
export async function resolveReview(
  project: Pick<ProjectRef, "id" | "name">,
  memoId: string,
  decision: ReviewDecision,
  actor: SessionUser,
  content?: string,
  title?: string,
): Promise<void> {
  if (!(await canReviewProject(project, actor))) throw new NotAReviewerError(project.name);
  const queue = port("reviewQueue");
  if (!(await queue.isPending(project.id, memoId))) return;

  if (decision === "skip") return queue.skip(memoId);
  if (await judge(memoId, decision, "obsolete", actor, content, title)) await queue.resolve(memoId, RESOLUTION[decision], actor.email);
}

/**
 * The same decisions on a memo nobody has checked yet, except that discarding it rejects it: it was
 * never true or never worth knowing, where an older memo held once (ADR-0093). The verdict itself
 * takes it out of the lane.
 */
export async function resolveUnchecked(
  project: Pick<ProjectRef, "id" | "name">,
  memoId: string,
  decision: ReviewDecision,
  actor: SessionUser,
  content?: string,
  title?: string,
): Promise<void> {
  if (!(await canReviewProject(project, actor))) throw new NotAReviewerError(project.name);
  const queue = port("verificationQueue");
  if (!(await queue.isPending(project.id, memoId))) return;

  if (decision === "skip") return queue.skip(memoId);
  await judge(memoId, decision, "rejected", actor, content, title);
}

async function judge(
  memoId: string,
  decision: Exclude<ReviewDecision, "skip">,
  discardedAs: Extract<ReviewVerdict, "obsolete" | "rejected">,
  actor: SessionUser,
  content?: string,
  title?: string,
): Promise<boolean> {
  if (decision === "modify") {
    const rewritten = content?.trim();
    if (!rewritten) return false;
    await updateEntryFields(memoId, { content: rewritten, title: title?.trim() || undefined });
  }
  await validateEntry(memoId, decision === "discard" ? discardedAs : "validated", { email: actor.email, channel: "web" });
  return true;
}

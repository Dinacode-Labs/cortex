import { port } from "../../composition.js";
import type { SessionUser } from "../../auth/domain/session-user.js";
import { canReviewProject, NotAReviewerError } from "../../projects/application/projects.js";
import type { ProjectRef } from "../../projects/domain/project.js";
import type { Memo } from "../domain/memo.js";
import { confidenceAfterReview, type Reviewer, type ReviewVerdict } from "../domain/review.js";
import type { ReviewDecision } from "../domain/review-queue.js";
import { updateEntryFields } from "./dedup.js";

export async function validateEntry(id: string, verdict: ReviewVerdict, reviewer: Reviewer): Promise<Memo | null> {
  return port("memos").review(id, { verdict, reviewer, confidence: confidenceAfterReview(verdict, reviewer.channel) });
}

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
): Promise<void> {
  if (!(await canReviewProject(project, actor))) throw new NotAReviewerError(project.name);
  const queue = port("reviewQueue");
  if (!(await queue.isPending(project.id, memoId))) return;

  const reviewer: Reviewer = { email: actor.email, channel: "web" };
  switch (decision) {
    case "skip":
      await queue.skip(memoId);
      return;
    case "keep":
      await validateEntry(memoId, "validated", reviewer);
      await queue.resolve(memoId, "kept", actor.email);
      return;
    case "discard":
      await validateEntry(memoId, "obsolete", reviewer);
      await queue.resolve(memoId, "discarded", actor.email);
      return;
    case "modify": {
      const rewritten = content?.trim();
      if (!rewritten) return;
      await updateEntryFields(memoId, { content: rewritten });
      await validateEntry(memoId, "validated", reviewer);
      await queue.resolve(memoId, "modified", actor.email);
      return;
    }
  }
}

import { getEnvNum } from "@cortex/shared";
import { port } from "../../composition.js";
import type { Memo } from "../domain/memo.js";
import type { SearchHit } from "../domain/memo-index.js";
import { olderMemosToReview, type PendingReview } from "../domain/review-queue.js";
import type { ProjectRef } from "../../projects/domain/project.js";
import type { SessionUser } from "../../auth/domain/session-user.js";
import { canReviewProject } from "../../projects/application/projects.js";

/** Below the reconciler's band (0.82) on purpose: a contradiction is usually worded differently. */
export const REVIEW_THRESHOLD = getEnvNum("CORTEX_REVIEW_THRESHOLD", 0.75);

export async function queueReviewsOf(newer: Memo, neighbours: SearchHit[]): Promise<void> {
  if (!newer.projectId) return;
  await port("reviewQueue").enqueue(newer.projectId, newer.id, olderMemosToReview(neighbours, REVIEW_THRESHOLD));
}

export async function nextReview(project: Pick<ProjectRef, "id">): Promise<PendingReview | null> {
  return port("reviewQueue").next(project.id);
}

export async function pendingReviewCount(project: Pick<ProjectRef, "id">): Promise<number> {
  return port("reviewQueue").pendingCount(project.id);
}

export async function isAwaitingReview(project: Pick<ProjectRef, "id">, memoId: string): Promise<boolean> {
  return port("reviewQueue").isPending(project.id, memoId);
}

/**
 * Both lanes of Review together. Only where the viewer may judge: a count they can do nothing
 * about is noise (docs/design.md §1).
 */
export async function reviewsAwaiting(viewer: SessionUser | null, projects: Pick<ProjectRef, "id">[]): Promise<Map<string, number>> {
  const ids = projects.map((p) => p.id);
  const [older, unchecked] = await Promise.all([port("reviewQueue").pendingCounts(ids), port("verificationQueue").pendingCounts(ids)]);
  const counts = new Map(older);
  for (const [projectId, n] of unchecked) counts.set(projectId, (counts.get(projectId) ?? 0) + n);
  const awaiting = new Map<string, number>();
  for (const [projectId, n] of counts) if (await canReviewProject({ id: projectId }, viewer)) awaiting.set(projectId, n);
  return awaiting;
}

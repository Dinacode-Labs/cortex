import { getEnvNum } from "@cortex/shared";
import { port } from "../../composition.js";
import type { Memo } from "../domain/memo.js";
import type { SearchHit } from "../domain/memo-index.js";
import { olderMemosToReview, type PendingReview } from "../domain/review-queue.js";
import type { ProjectRef } from "../../projects/domain/project.js";

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

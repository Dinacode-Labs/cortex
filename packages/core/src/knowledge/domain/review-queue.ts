import type { Memo } from "./memo.js";
import type { SearchHit } from "./memo-index.js";

export type ReviewDecision = "keep" | "discard" | "modify" | "skip";
export type ReviewResolution = "kept" | "discarded" | "modified";

export function isReviewDecision(value: string): value is ReviewDecision {
  return value === "keep" || value === "discard" || value === "modify" || value === "skip";
}

export interface ReviewCandidate {
  memoId: string;
  similarity: number;
}

export interface NewerMemo {
  memo: Memo;
  similarity: number;
}

/** One older memo, with every newer one that made it worth a second look. */
export interface PendingReview {
  memo: Memo;
  newer: NewerMemo[];
}

/**
 * The port behind the Review section (ADR-0091). The queue is per OLDER memo: a person decides
 * about a memo once, whatever number of newer ones arrived about it.
 */
export interface ReviewQueue {
  enqueue(projectId: string, newerMemoId: string, candidates: ReviewCandidate[]): Promise<void>;
  /** Not skipped first, then the highest priority. Memos no longer in force drop out. */
  next(projectId: string): Promise<PendingReview | null>;
  pendingCount(projectId: string): Promise<number>;
  isPending(projectId: string, memoId: string): Promise<boolean>;
  resolve(memoId: string, resolution: ReviewResolution, by: string): Promise<void>;
  skip(memoId: string): Promise<void>;
}

/**
 * The memos a newer one is about. New knowledge is taken as valid; these are the ones it may have
 * left behind. Similarity is the only signal until an agent judges each pair, so it is also the
 * priority for now.
 */
export function olderMemosToReview(neighbours: SearchHit[], threshold: number): ReviewCandidate[] {
  return neighbours.filter((hit) => hit.score >= threshold).map((hit) => ({ memoId: hit.entry.id, similarity: hit.score }));
}

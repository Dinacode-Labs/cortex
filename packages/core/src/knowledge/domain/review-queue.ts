import type { Memo } from "./memo.js";
import type { SearchHit } from "./memo-index.js";
import type { GroupRelation, SweepGroup } from "./review-sweep.js";

export type ReviewDecision = "keep" | "discard" | "modify" | "skip";
export type ReviewResolution = "kept" | "discarded" | "modified" | "merged";

export function isReviewDecision(value: string): value is ReviewDecision {
  return value === "keep" || value === "discard" || value === "modify" || value === "skip";
}

export interface ReviewCandidate {
  memoId: string;
  similarity: number;
}

/** What the nightly pass's agent said of a memo it set against an older one (ADR-0098). */
export interface Finding {
  relation: GroupRelation;
  reason: string | null;
}

export interface NewerMemo {
  memo: Memo;
  similarity: number;
  finding: Finding | null;
}

export interface OlderMemo {
  memo: Memo;
  similarity: number;
}

/** One older memo, with every newer one that made it worth a second look. */
export interface PendingReview {
  memo: Memo;
  newer: NewerMemo[];
}

export interface QueuedMemo {
  memoId: string;
  lastQueuedAt: Date;
}

/**
 * The port behind the Review section (ADR-0091). The queue is per OLDER memo: a person decides
 * about a memo once, whatever number of newer ones arrived about it.
 */
export interface ReviewQueue {
  enqueue(projectId: string, newerMemoId: string, candidates: ReviewCandidate[]): Promise<void>;
  raiseGroup(projectId: string, group: SweepGroup): Promise<void>;
  /** Every pair among these memos ever queued, pending or decided, as `pairKey`s. */
  knownPairs(memoIds: string[]): Promise<Set<string>>;
  /** Not skipped first, then the highest priority. Memos no longer in force drop out. */
  next(projectId: string): Promise<PendingReview | null>;
  /** The next ones, in the same order. */
  upcoming(projectId: string, limit: number): Promise<PendingReview[]>;
  /** Null once the memo no longer waits. */
  pending(projectId: string, memoId: string): Promise<PendingReview | null>;
  pendingCount(projectId: string): Promise<number>;
  /** A project with nothing waiting is absent. */
  pendingCounts(projectIds: string[]): Promise<Map<string, number>>;
  queuedMemos(projectIds: string[]): Promise<Map<string, QueuedMemo[]>>;
  isPending(projectId: string, memoId: string): Promise<boolean>;
  /** The older memos a newer one raised that still wait, the most alike first. */
  raisedBy(projectId: string, newerMemoId: string): Promise<OlderMemo[]>;
  resolve(memoId: string, resolution: ReviewResolution, by: string): Promise<void>;
  skip(memoId: string): Promise<void>;
}

/**
 * The memos a newer one is about. New knowledge is taken as valid; these are the ones it may have
 * left behind. Similarity is the only signal until an agent judges each pair, so it is also the
 * priority for now. Only memos saved before it count: within one bulk upload every memo finds the
 * others, and without that each pair would come up twice, older and newer swapped (ADR-0094).
 */
export function olderMemosToReview(newer: Pick<Memo, "createdAt">, neighbours: SearchHit[], threshold: number): ReviewCandidate[] {
  return neighbours
    .filter((hit) => hit.score >= threshold && hit.entry.createdAt < newer.createdAt)
    .map((hit) => ({ memoId: hit.entry.id, similarity: hit.score }));
}

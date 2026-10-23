import type { Memo, MemoType } from "./memo.js";

export type ReviewLane = "older" | "new";

export function isReviewLane(value: string): value is ReviewLane {
  return value === "older" || value === "new";
}

export interface MergedMemo {
  title: string;
  content: string;
  type: MemoType;
}

export type MergeSource = Pick<Memo, "title" | "content" | "type" | "createdAt">;

export type MergeDraft = Pick<MergedMemo, "title" | "content">;

/**
 * The drafts the consolidation agent wrote, each for a set of memos as they read then (ADR-0096):
 * a memo rewritten since, or one more memo in the review, and the draft no longer applies. A failed
 * draft is kept as well, so the pass ahead does not ask the model again until something changes.
 */
export interface MergeDraftStore {
  /** Null when there is none, it failed, or a memo changed since. */
  find(memos: Memo[]): Promise<MergeDraft | null>;
  /** Drafted or failed, for these memos as they read now. */
  tried(memos: Memo[]): Promise<boolean>;
  /** Null records a failure. */
  save(projectId: string, memos: Memo[], draft: MergeDraft | null): Promise<void>;
  /** Drops the drafts that quote a memo no longer in force: their review is over. */
  prune(): Promise<number>;
}

export interface MergeProposal extends MergedMemo {
  /** Oldest first. */
  memos: Memo[];
  /** False when no model wrote it and the texts are only put together for a person to merge. */
  drafted: boolean;
}

export function oldestFirst<T extends Pick<Memo, "createdAt">>(memos: T[]): T[] {
  return [...memos].sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime());
}

/**
 * The newest leads: where the memos disagree it is the one taken as true (ADR-0091), so it is where
 * a person merging by hand starts from.
 */
export function mergeByHand(memos: MergeSource[]): MergedMemo {
  const newestFirst = oldestFirst(memos).reverse();
  const newest = newestFirst[0]!;
  return {
    title: newest.title,
    type: newest.type,
    content: newestFirst.map((m) => m.content.trim()).join("\n\n"),
  };
}

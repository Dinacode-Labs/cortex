import type { Memo, MemoType } from "./memo.js";
import type { OlderMemo, QueuedMemo } from "./review-queue.js";

/** A memo nobody has checked, with the older ones it put up for review, so it is judged knowing them. */
export interface UncheckedMemo {
  memo: Memo;
  touches: OlderMemo[];
}

/**
 * The port behind Review's second lane (ADR-0093). A memo saved since the lane began waits there
 * until a person gives it a verdict on the web: an agent's through MCP leaves it waiting (ADR-0090).
 */
export interface VerificationQueue {
  enqueue(memoId: string): Promise<void>;
  /** Not skipped first, then by `typeOrder` with the types outside it last, then the newest. */
  next(projectId: string, typeOrder: readonly MemoType[]): Promise<Memo | null>;
  /** The next ones, in the same order. */
  upcoming(projectId: string, typeOrder: readonly MemoType[], limit: number): Promise<Memo[]>;
  pendingCount(projectId: string): Promise<number>;
  /** A project with nothing waiting is absent. */
  pendingCounts(projectIds: string[]): Promise<Map<string, number>>;
  queuedMemos(projectIds: string[]): Promise<Map<string, QueuedMemo[]>>;
  isPending(projectId: string, memoId: string): Promise<boolean>;
  skip(memoId: string): Promise<void>;
}

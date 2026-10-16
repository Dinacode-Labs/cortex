import type { Row, Sql } from "@cortex/database";
import { rowToMemo } from "./memo.row.js";
import type { PendingReview, ReviewCandidate, ReviewQueue, ReviewResolution } from "../domain/review-queue.js";

export class PgReviewQueue implements ReviewQueue {
  constructor(private readonly sql: Sql) {}

  async enqueue(projectId: string, newerMemoId: string, candidates: ReviewCandidate[]): Promise<void> {
    if (candidates.length === 0) return;
    const rows = candidates.map((c) => ({
      project_id: projectId,
      memo_id: c.memoId,
      newer_memo_id: newerMemoId,
      similarity: c.similarity,
      priority: c.similarity,
    }));
    await this.sql`
      INSERT INTO review_queue ${this.sql(rows, "project_id", "memo_id", "newer_memo_id", "similarity", "priority")}
      ON CONFLICT (memo_id, newer_memo_id) DO NOTHING
    `;
  }

  // A review only stands while both memos are still in force: once either was discarded,
  // superseded or purged, there is nothing left to compare.
  private live(projectId: string) {
    return this.sql`
      SELECT q.memo_id, q.newer_memo_id, q.similarity, q.priority, q.skipped_at, q.created_at
        FROM review_queue q
        JOIN memos m ON m.id = q.memo_id
        JOIN memos n ON n.id = q.newer_memo_id
       WHERE q.project_id = ${projectId} AND q.status = 'pending'
         AND m.valid_to IS NULL AND m.status NOT IN ('rejected', 'obsolete', 'superseded')
         AND n.valid_to IS NULL AND n.status NOT IN ('rejected', 'obsolete', 'superseded')
    `;
  }

  async next(projectId: string): Promise<PendingReview | null> {
    const [head] = (await this.sql`
      SELECT memo_id
        FROM (${this.live(projectId)}) live
       GROUP BY memo_id
       ORDER BY max(skipped_at) ASC NULLS FIRST, max(priority) DESC, min(created_at) ASC
       LIMIT 1
    `) as unknown as Row[];
    if (!head) return null;
    const memoId = head.memo_id as string;
    const [older] = (await this.sql`SELECT * FROM memos WHERE id = ${memoId}`) as unknown as Row[];
    if (!older) return null;
    const newer = (await this.sql`
      SELECT n.*, live.similarity AS review_similarity
        FROM (${this.live(projectId)}) live
        JOIN memos n ON n.id = live.newer_memo_id
       WHERE live.memo_id = ${memoId}
       ORDER BY n.created_at DESC
    `) as unknown as Row[];
    return {
      memo: rowToMemo(older),
      newer: newer.map((r) => ({ memo: rowToMemo(r), similarity: Number(r.review_similarity) })),
    };
  }

  async pendingCount(projectId: string): Promise<number> {
    const [row] = (await this.sql`SELECT count(DISTINCT memo_id)::int AS n FROM (${this.live(projectId)}) live`) as unknown as Row[];
    return (row?.n as number) ?? 0;
  }

  async isPending(projectId: string, memoId: string): Promise<boolean> {
    const rows = (await this.sql`SELECT 1 FROM (${this.live(projectId)}) live WHERE memo_id = ${memoId} LIMIT 1`) as unknown as Row[];
    return rows.length > 0;
  }

  async resolve(memoId: string, resolution: ReviewResolution, by: string): Promise<void> {
    await this.sql`
      UPDATE review_queue
         SET status = 'resolved', resolution = ${resolution}, resolved_by = ${by.toLowerCase()}, resolved_at = now()
       WHERE memo_id = ${memoId} AND status = 'pending'
    `;
  }

  async skip(memoId: string): Promise<void> {
    await this.sql`UPDATE review_queue SET skipped_at = now() WHERE memo_id = ${memoId} AND status = 'pending'`;
  }
}

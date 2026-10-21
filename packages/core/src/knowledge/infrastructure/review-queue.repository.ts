import type { Row, Sql } from "@cortex/database";
import { rowToMemo } from "./memo.row.js";
import type { OlderMemo, PendingReview, QueuedMemo, ReviewCandidate, ReviewQueue, ReviewResolution } from "../domain/review-queue.js";

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
  private live(projectId: string | string[]) {
    const ids = Array.isArray(projectId) ? projectId : [projectId];
    return this.sql`
      SELECT q.project_id, q.memo_id, q.newer_memo_id, q.similarity, q.priority, q.skipped_at, q.created_at
        FROM review_queue q
        JOIN memos m ON m.id = q.memo_id
        JOIN memos n ON n.id = q.newer_memo_id
       WHERE q.project_id = ANY(${ids}) AND q.status = 'pending'
         AND m.valid_to IS NULL AND m.status NOT IN ('rejected', 'obsolete', 'superseded')
         AND n.valid_to IS NULL AND n.status NOT IN ('rejected', 'obsolete', 'superseded')
    `;
  }

  async next(projectId: string): Promise<PendingReview | null> {
    const [head] = await this.upcoming(projectId, 1);
    return head ?? null;
  }

  async upcoming(projectId: string, limit: number): Promise<PendingReview[]> {
    const heads = (await this.sql`
      SELECT memo_id
        FROM (${this.live(projectId)}) live
       GROUP BY memo_id
       ORDER BY max(skipped_at) ASC NULLS FIRST, max(priority) DESC, min(created_at) ASC
       LIMIT ${limit}
    `) as unknown as Row[];
    const reviews = await Promise.all(heads.map((h) => this.pending(projectId, h.memo_id as string)));
    return reviews.filter((r): r is PendingReview => r !== null);
  }

  async pending(projectId: string, memoId: string): Promise<PendingReview | null> {
    const newer = (await this.sql`
      SELECT n.*, live.similarity AS review_similarity
        FROM (${this.live(projectId)}) live
        JOIN memos n ON n.id = live.newer_memo_id
       WHERE live.memo_id = ${memoId}
       ORDER BY n.created_at DESC
    `) as unknown as Row[];
    if (newer.length === 0) return null;
    const [older] = (await this.sql`SELECT * FROM memos WHERE id = ${memoId}`) as unknown as Row[];
    if (!older) return null;
    return {
      memo: rowToMemo(older),
      newer: newer.map((r) => ({ memo: rowToMemo(r), similarity: Number(r.review_similarity) })),
    };
  }

  async pendingCount(projectId: string): Promise<number> {
    const [row] = (await this.sql`SELECT count(DISTINCT memo_id)::int AS n FROM (${this.live(projectId)}) live`) as unknown as Row[];
    return (row?.n as number) ?? 0;
  }

  async pendingCounts(projectIds: string[]): Promise<Map<string, number>> {
    if (projectIds.length === 0) return new Map();
    const rows = (await this.sql`
      SELECT project_id, count(DISTINCT memo_id)::int AS n FROM (${this.live(projectIds)}) live GROUP BY project_id
    `) as unknown as Row[];
    return new Map(rows.map((r) => [r.project_id as string, Number(r.n)]));
  }

  async queuedMemos(projectIds: string[]): Promise<Map<string, QueuedMemo[]>> {
    if (projectIds.length === 0) return new Map();
    const rows = (await this.sql`
      SELECT project_id, memo_id, max(created_at) AS last_queued_at
        FROM (${this.live(projectIds)}) live
       GROUP BY project_id, memo_id
    `) as unknown as Row[];
    const queued = new Map<string, QueuedMemo[]>();
    for (const r of rows) {
      const projectId = r.project_id as string;
      queued.set(projectId, [...(queued.get(projectId) ?? []), { memoId: r.memo_id as string, lastQueuedAt: new Date(r.last_queued_at as string) }]);
    }
    return queued;
  }

  async isPending(projectId: string, memoId: string): Promise<boolean> {
    const rows = (await this.sql`SELECT 1 FROM (${this.live(projectId)}) live WHERE memo_id = ${memoId} LIMIT 1`) as unknown as Row[];
    return rows.length > 0;
  }

  async raisedBy(projectId: string, newerMemoId: string): Promise<OlderMemo[]> {
    const rows = (await this.sql`
      SELECT m.*, live.similarity AS review_similarity
        FROM (${this.live(projectId)}) live
        JOIN memos m ON m.id = live.memo_id
       WHERE live.newer_memo_id = ${newerMemoId}
       ORDER BY live.similarity DESC
    `) as unknown as Row[];
    return rows.map((r) => ({ memo: rowToMemo(r), similarity: Number(r.review_similarity) }));
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

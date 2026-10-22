import type { Row, Sql } from "@cortex/database";
import { rowToMemo } from "./memo.row.js";
import type { Memo, MemoType } from "../domain/memo.js";
import type { VerificationQueue } from "../domain/verification-queue.js";

export class PgVerificationQueue implements VerificationQueue {
  constructor(private readonly sql: Sql) {}

  async enqueue(memoId: string): Promise<void> {
    await this.sql`INSERT INTO verification_queue (memo_id) VALUES (${memoId}) ON CONFLICT (memo_id) DO NOTHING`;
  }

  // Waiting ends with a person's verdict on the web, the only one that makes a memo verified
  // (ADR-0090), or once the memo is no longer in force.
  private live(projectIds: string[]) {
    return this.sql`
      SELECT m.*, q.skipped_at AS check_skipped_at
        FROM verification_queue q
        JOIN memos m ON m.id = q.memo_id
       WHERE m.project_id = ANY(${projectIds})
         AND m.valid_to IS NULL AND m.status NOT IN ('rejected', 'obsolete', 'superseded')
         AND NOT EXISTS (SELECT 1 FROM memo_reviews r WHERE r.memo_id = q.memo_id AND r.channel = 'web')
    `;
  }

  async next(projectId: string, typeOrder: readonly MemoType[]): Promise<Memo | null> {
    const [row] = (await this.sql`
      SELECT *
        FROM (${this.live([projectId])}) live
       ORDER BY check_skipped_at ASC NULLS FIRST, array_position(${[...typeOrder]}::text[], type) ASC NULLS LAST, created_at DESC
       LIMIT 1
    `) as unknown as Row[];
    return row ? rowToMemo(row) : null;
  }

  async pendingCount(projectId: string): Promise<number> {
    const [row] = (await this.sql`SELECT count(*)::int AS n FROM (${this.live([projectId])}) live`) as unknown as Row[];
    return (row?.n as number) ?? 0;
  }

  async pendingCounts(projectIds: string[]): Promise<Map<string, number>> {
    if (projectIds.length === 0) return new Map();
    const rows = (await this.sql`
      SELECT project_id, count(*)::int AS n FROM (${this.live(projectIds)}) live GROUP BY project_id
    `) as unknown as Row[];
    return new Map(rows.map((r) => [r.project_id as string, Number(r.n)]));
  }

  async isPending(projectId: string, memoId: string): Promise<boolean> {
    const rows = (await this.sql`SELECT 1 FROM (${this.live([projectId])}) live WHERE id = ${memoId} LIMIT 1`) as unknown as Row[];
    return rows.length > 0;
  }

  async skip(memoId: string): Promise<void> {
    await this.sql`UPDATE verification_queue SET skipped_at = now() WHERE memo_id = ${memoId}`;
  }
}

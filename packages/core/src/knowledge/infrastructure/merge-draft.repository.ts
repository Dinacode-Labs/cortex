import { createHash } from "node:crypto";
import type { Row, Sql } from "@cortex/database";
import type { Memo } from "../domain/memo.js";
import type { MergeDraft, MergeDraftStore } from "../domain/memo-merge.js";

const keyOf = (memos: Memo[]): string[] => memos.map((m) => m.id).sort();

// What the model read, not just which memos: one rewritten since leaves the same ids behind.
function hashOf(memos: Memo[]): string {
  const hash = createHash("sha256");
  for (const m of [...memos].sort((a, b) => a.id.localeCompare(b.id))) hash.update(`${m.id}\0${m.type}\0${m.title}\0${m.content}\0`);
  return hash.digest("hex");
}

export class PgMergeDraftStore implements MergeDraftStore {
  constructor(private readonly sql: Sql) {}

  private async current(memos: Memo[]): Promise<Row | null> {
    const [row] = (await this.sql`
      SELECT title, content FROM merge_drafts WHERE memo_ids = ${keyOf(memos)}::uuid[] AND source_hash = ${hashOf(memos)}
    `) as unknown as Row[];
    return row ?? null;
  }

  async find(memos: Memo[]): Promise<MergeDraft | null> {
    const row = await this.current(memos);
    return row && row.content !== null ? { title: row.title as string, content: row.content as string } : null;
  }

  async tried(memos: Memo[]): Promise<boolean> {
    return (await this.current(memos)) !== null;
  }

  async save(projectId: string, memos: Memo[], draft: MergeDraft | null): Promise<void> {
    await this.sql`
      INSERT INTO merge_drafts (memo_ids, project_id, source_hash, title, content)
      VALUES (${keyOf(memos)}::uuid[], ${projectId}, ${hashOf(memos)}, ${draft?.title ?? null}, ${draft?.content ?? null})
      ON CONFLICT (memo_ids) DO UPDATE
        SET source_hash = EXCLUDED.source_hash, title = EXCLUDED.title, content = EXCLUDED.content, drafted_at = now()
    `;
  }

  async prune(): Promise<number> {
    const rows = (await this.sql`
      DELETE FROM merge_drafts d
       WHERE EXISTS (
         SELECT 1 FROM unnest(d.memo_ids) AS quoted(id)
           LEFT JOIN memos m ON m.id = quoted.id
          WHERE m.id IS NULL OR m.valid_to IS NOT NULL OR m.status IN ('rejected', 'obsolete', 'superseded')
       )
      RETURNING 1
    `) as unknown as Row[];
    return rows.length;
  }
}

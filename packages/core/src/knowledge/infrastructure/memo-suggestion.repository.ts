import { createHash } from "node:crypto";
import type { Row, Sql } from "@cortex/database";
import type { Memo } from "../domain/memo.js";
import type { MemoSuggestion, MemoSuggestionStore } from "../domain/memo-suggestion.js";

// What the model read, not just which memo: a memo rewritten since keeps its id.
function hashOf(memo: Memo): string {
  return createHash("sha256").update(`${memo.id}\0${memo.type}\0${memo.title}\0${memo.content}`).digest("hex");
}

function suggestionOf(row: Row): MemoSuggestion | null {
  const reason = (row.reason as string | null) ?? "";
  if (row.kind === "reject") return { kind: "reject", reason };
  if (row.kind === "rewrite" && row.title && row.content) return { kind: "rewrite", title: row.title as string, content: row.content as string, reason };
  return null;
}

export class PgMemoSuggestionStore implements MemoSuggestionStore {
  constructor(private readonly sql: Sql) {}

  private async current(memo: Memo): Promise<Row | null> {
    const [row] = (await this.sql`
      SELECT kind, title, content, reason FROM memo_suggestions WHERE memo_id = ${memo.id} AND source_hash = ${hashOf(memo)}
    `) as unknown as Row[];
    return row ?? null;
  }

  async find(memo: Memo): Promise<MemoSuggestion | null> {
    const row = await this.current(memo);
    return row && suggestionOf(row);
  }

  async tried(memo: Memo): Promise<boolean> {
    return (await this.current(memo)) !== null;
  }

  async save(projectId: string, memo: Memo, suggestion: MemoSuggestion | null): Promise<void> {
    const rewrite = suggestion?.kind === "rewrite" ? suggestion : null;
    await this.sql`
      INSERT INTO memo_suggestions (memo_id, project_id, source_hash, kind, title, content, reason)
      VALUES (${memo.id}, ${projectId}, ${hashOf(memo)}, ${suggestion?.kind ?? null}, ${rewrite?.title ?? null},
              ${rewrite?.content ?? null}, ${suggestion?.reason ?? null})
      ON CONFLICT (memo_id) DO UPDATE
        SET project_id = EXCLUDED.project_id, source_hash = EXCLUDED.source_hash, kind = EXCLUDED.kind, title = EXCLUDED.title,
            content = EXCLUDED.content, reason = EXCLUDED.reason, suggested_at = now()
    `;
  }
}

import { toVectorLiteral, type Sql } from "@cortex/database";
import type { EmbeddingProvider } from "@cortex/embeddings";
import type { Row } from "../../infrastructure/rows.js";
import { rrfFuse } from "../../knowledge/domain/rank.js";
import type { CodeChunk, CodeHit, CodeIndex } from "../domain/code.js";

// Characters per embedding request, so a batch of dense code stays within the model's context
// (qwen3-embedding: 32768 tokens).
const BATCH_CHAR_BUDGET = 28_000;

export class PgCodeIndex implements CodeIndex {
  constructor(
    private readonly sql: Sql,
    private readonly provider: EmbeddingProvider,
  ) {}

  async replace(
    projectId: string,
    repoName: string,
    all: CodeChunk[],
    opts: { batchSize: number; onProgress?: (done: number, total: number) => void },
  ): Promise<void> {
    const { sql, provider } = this;
    const batchSize = opts.batchSize;
    await sql`DELETE FROM code_chunks WHERE project_id = ${projectId} AND repo = ${repoName}`;

    let i = 0;
    let done = 0;
    while (i < all.length) {
      const batch: CodeChunk[] = [];
      let chars = 0;
      while (i < all.length && batch.length < batchSize && (batch.length === 0 || chars + all[i]!.content.length <= BATCH_CHAR_BUDGET)) {
        chars += all[i]!.content.length;
        batch.push(all[i]!);
        i++;
      }
      const vecs = await provider.embed(batch.map((c) => c.content));
      for (let j = 0; j < batch.length; j++) {
        const c = batch[j]!;
        await sql`
          INSERT INTO code_chunks (project_id, repo, path, language, start_line, end_line, content, embedding_model, dim, embedding)
          VALUES (${projectId}, ${repoName}, ${c.relPath}, ${c.language}, ${c.startLine}, ${c.endLine},
                  ${c.content}, ${provider.model}, ${provider.dim}, ${toVectorLiteral(vecs[j]!)}::vector)
        `;
      }
      done += batch.length;
      opts.onProgress?.(done, all.length);
    }
  }

  async search(projectId: string, query: string, limit: number): Promise<CodeHit[]> {
    const { sql, provider } = this;
    const pool = Math.max(limit * 4, 32);
    const vectors = await provider.embed([query]);
    const lit = toVectorLiteral(vectors[0]!);

    const vecRows = (await sql`
      SELECT id, (embedding <=> ${lit}::vector) AS distance
      FROM code_chunks
      WHERE project_id = ${projectId} AND embedding_model = ${provider.model}
      ORDER BY distance ASC LIMIT ${pool}
    `) as unknown as Row[];

    const ftsRows = (await sql`
      SELECT id, ts_rank(content_tsv, plainto_tsquery('simple', ${query})) AS rank
      FROM code_chunks
      WHERE project_id = ${projectId} AND content_tsv @@ plainto_tsquery('simple', ${query})
      ORDER BY rank DESC LIMIT ${pool}
    `) as unknown as Row[];

    // Reciprocal Rank Fusion (the shared fusion lives in rrfFuse). Unlike the memos' hybrid
    // search, code search does NOT normalise the RRF: it uses the cosine when there is one,
    // or the raw RRF.
    const ranked = rrfFuse(
      vecRows as unknown as { id: string; distance?: number | string }[],
      ftsRows as unknown as { id: string }[],
      limit,
    );
    if (ranked.length === 0) return [];
    const ids = ranked.map((s) => s.id);
    const rows = (await sql`SELECT * FROM code_chunks WHERE id IN ${sql(ids)}`) as unknown as Row[];
    const byId = new Map(rows.map((r) => [r.id as string, r]));

    return ranked
      .filter((s) => byId.has(s.id))
      .map((s) => {
        const r = byId.get(s.id)!;
        return {
          path: r.path as string,
          startLine: Number(r.start_line),
          endLine: Number(r.end_line),
          language: (r.language as string) ?? null,
          content: r.content as string,
          score: s.cosine ?? s.rrf,
        };
      });
  }
}

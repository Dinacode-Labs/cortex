import { toVectorLiteral, type Sql, type SqlFragment } from "@cortex/database";
import type { EmbeddingProvider } from "@cortex/embeddings";
import { rowToMemo, type Row } from "../../storage/map.js";
import type { MemoIndex, MemoSearchScope, SearchHit } from "../domain/memo-index.js";
import { rrfFuse } from "../domain/rank.js";

/**
 * Each memo is indexed in its own language (ADR-0082) and the query's is unknown, so the query
 * is stemmed both ways: a Spanish stem matches Spanish memos, an English one English memos.
 */
export async function lexicalMatches(
  sql: Sql,
  queryText: string,
  filters: SqlFragment,
  limit: number,
): Promise<{ id: string; rank: number }[]> {
  const query = sql`(plainto_tsquery('spanish', ${queryText}) || plainto_tsquery('english', ${queryText}))`;
  const rows = (await sql`
    SELECT m.id, ts_rank(m.content_tsv, ${query}) AS rank
    FROM memos m
    WHERE m.content_tsv @@ ${query}
    ${filters}
    ORDER BY rank DESC
    LIMIT ${limit}
  `) as unknown as Row[];
  return rows.map((r) => ({ id: r.id as string, rank: Number(r.rank) }));
}

export class PgMemoIndex implements MemoIndex {
  constructor(
    private readonly sql: Sql,
    private readonly provider: EmbeddingProvider,
  ) {}

  async index(memoId: string, text: string): Promise<void> {
    await this.indexMany([{ memoId, text }]);
  }

  /** One request per batch, and the batches in sequence, to stay within the provider's limits. */
  async indexMany(
    items: { memoId: string; text: string }[],
    opts: { batchSize?: number; onProgress?: (done: number) => void } = {},
  ): Promise<void> {
    const batchSize = opts.batchSize ?? 32;
    for (let i = 0; i < items.length; i += batchSize) {
      const chunk = items.slice(i, i + batchSize);
      const vectors = await this.provider.embed(chunk.map((r) => r.text));
      for (let j = 0; j < chunk.length; j++) {
        await this.sql`
          INSERT INTO embeddings (memo_id, embedding_model, embedding_version, dim, vector, chunk_index)
          VALUES (${chunk[j]!.memoId}, ${this.provider.model}, ${this.provider.version}, ${this.provider.dim},
                  ${toVectorLiteral(vectors[j]!)}::vector, 0)
          ON CONFLICT (memo_id, embedding_model, embedding_version, chunk_index)
          DO UPDATE SET vector = EXCLUDED.vector, dim = EXCLUDED.dim, created_at = now()
        `;
      }
      opts.onProgress?.(Math.min(i + batchSize, items.length));
    }
  }

  /** Only vectors of the current embedding model are compared: another model has another dimension. */
  async similar(queryText: string, scope: MemoSearchScope, limit: number): Promise<SearchHit[]> {
    const lit = await this.queryVector(queryText);
    const rows = (await this.sql`
      SELECT m.*, e.vector <=> ${lit}::vector AS distance
      FROM embeddings e
      JOIN memos m ON m.id = e.memo_id
      WHERE e.embedding_model = ${this.provider.model} AND e.embedding_version = ${this.provider.version}
      ${this.scopeFilters(scope)}
      ORDER BY distance ASC
      LIMIT ${limit}
    `) as unknown as Row[];
    return rows.map((row) => ({ entry: rowToMemo(row), score: 1 - Number(row.distance) }));
  }

  /** The lexical side brings precision on ids, proper nouns and jargon; the vector side, meaning. */
  async hybrid(queryText: string, scope: MemoSearchScope, limit: number): Promise<SearchHit[]> {
    const pool = Math.max(limit * 4, 40);
    const filters = this.scopeFilters(scope);
    const lit = await this.queryVector(queryText);
    const vecRows = (await this.sql`
      SELECT m.id, (e.vector <=> ${lit}::vector) AS distance
      FROM embeddings e
      JOIN memos m ON m.id = e.memo_id
      WHERE e.embedding_model = ${this.provider.model} AND e.embedding_version = ${this.provider.version}
      ${filters}
      ORDER BY distance ASC
      LIMIT ${pool}
    `) as unknown as Row[];
    const ftsRows = await lexicalMatches(this.sql, queryText, filters, pool);

    const ranked = rrfFuse(vecRows as unknown as { id: string; distance?: number | string }[], ftsRows, limit);
    if (ranked.length === 0) return [];
    // Hybrid NORMALISES the RRF by the maximum (the first one) to land it in [0,1].
    const maxRrf = ranked[0]!.rrf || 1;
    const rows = (await this.sql`SELECT * FROM memos WHERE id IN ${this.sql(ranked.map((s) => s.id))}`) as unknown as Row[];
    const byId = new Map(rows.map((r) => [r.id as string, r]));
    return ranked
      .filter((s) => byId.has(s.id))
      .map((s) => ({ entry: rowToMemo(byId.get(s.id)!), score: s.cosine ?? s.rrf / maxRrf }));
  }

  private async queryVector(queryText: string): Promise<string> {
    const vectors = await this.provider.embed([queryText]);
    return toVectorLiteral(vectors[0]!);
  }

  private scopeFilters(scope: MemoSearchScope): SqlFragment {
    const sql = this.sql;
    let filters = sql``;
    if (scope.projectId) filters = sql`${filters} AND m.project_id = ${scope.projectId}`;
    // An empty array -> `= ANY('{}')` matches nothing -> zero rows (fail-closed).
    else if (scope.projectIds) filters = sql`${filters} AND m.project_id = ANY(${scope.projectIds})`;
    if (scope.type) filters = sql`${filters} AND m.type = ${scope.type}`;
    if (scope.excludeId) filters = sql`${filters} AND m.id <> ${scope.excludeId}`;
    if (!scope.includeArchived) filters = sql`${filters} AND m.status NOT IN ('rejected', 'obsolete')`;
    if (scope.asOf) {
      filters = sql`${filters} AND m.valid_from <= ${scope.asOf} AND (m.valid_to IS NULL OR m.valid_to > ${scope.asOf})`;
    } else if (!scope.includeHistorical) {
      filters = sql`${filters} AND m.valid_to IS NULL`;
    }
    return filters;
  }
}

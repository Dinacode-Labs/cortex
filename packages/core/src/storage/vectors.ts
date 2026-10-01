import { toVectorLiteral, type Sql } from "@cortex/database";
import type { EmbeddingProvider } from "@cortex/embeddings";

import { rowToMemo, type Row } from "./map.js";
import type { Memo, MemoType } from "../knowledge/domain/memo.js";

export async function storeEmbedding(
  sql: Sql,
  provider: EmbeddingProvider,
  memoId: string,
  text: string,
): Promise<void> {
  const vectors = await provider.embed([text]);
  const vec = vectors[0]!;
  await sql`
    INSERT INTO embeddings (memo_id, embedding_model, embedding_version, dim, vector, chunk_index)
    VALUES (${memoId}, ${provider.model}, ${provider.version}, ${provider.dim},
            ${toVectorLiteral(vec)}::vector, 0)
    ON CONFLICT (memo_id, embedding_model, embedding_version, chunk_index)
    DO UPDATE SET vector = EXCLUDED.vector, dim = EXCLUDED.dim, created_at = now()
  `;
}

/**
 * Generates and stores embeddings in batches (1 request per batch). It respects the provider's
 * limits (e.g. 60 rpm, 3 in parallel) by running the batches sequentially.
 */
export async function storeEmbeddingsBatch(
  sql: Sql,
  provider: EmbeddingProvider,
  rows: { memoId: string; text: string }[],
  opts: { batchSize?: number; onProgress?: (done: number) => void } = {},
): Promise<void> {
  const batchSize = opts.batchSize ?? 32;
  for (let i = 0; i < rows.length; i += batchSize) {
    const chunk = rows.slice(i, i + batchSize);
    const vectors = await provider.embed(chunk.map((r) => r.text));
    for (let j = 0; j < chunk.length; j++) {
      const vec = vectors[j]!;
      await sql`
        INSERT INTO embeddings (memo_id, embedding_model, embedding_version, dim, vector, chunk_index)
        VALUES (${chunk[j]!.memoId}, ${provider.model}, ${provider.version}, ${provider.dim},
                ${toVectorLiteral(vec)}::vector, 0)
        ON CONFLICT (memo_id, embedding_model, embedding_version, chunk_index)
        DO UPDATE SET vector = EXCLUDED.vector, dim = EXCLUDED.dim, created_at = now()
      `;
    }
    opts.onProgress?.(Math.min(i + batchSize, rows.length));
  }
}

export interface SearchHit {
  entry: Memo;
  /** Relevance in [0,1]. In hybrid it is normalised RRF; in vector search, cosine. */
  score: number;
}

/**
 * Reciprocal Rank Fusion: merges a vector list and a lexical (FTS) one by adding
 * `1/(K+rank+1)` per position in each list. The vector branch additionally keeps the cosine
 * (`1 - distance`). It returns the list ordered by RRF desc and cut to `limit`. A PURE
 * function (no database): each caller then decides how to derive its final score from
 * `rrf`/`cosine` (hybrid normalises, for instance; code search does not).
 */
export function rrfFuse(
  vecRows: { id: string; distance?: number | string }[],
  ftsRows: { id: string }[],
  limit: number,
  K = 60,
): { id: string; rrf: number; cosine?: number }[] {
  const acc = new Map<string, { rrf: number; cosine?: number }>();
  vecRows.forEach((r, i) => {
    const cur = acc.get(r.id) ?? { rrf: 0 };
    cur.rrf += 1 / (K + i + 1);
    cur.cosine = 1 - Number(r.distance);
    acc.set(r.id, cur);
  });
  ftsRows.forEach((r, i) => {
    const cur = acc.get(r.id) ?? { rrf: 0 };
    cur.rrf += 1 / (K + i + 1);
    acc.set(r.id, cur);
  });
  return [...acc.entries()]
    .sort((a, b) => b[1].rrf - a[1].rrf)
    .slice(0, limit)
    .map(([id, s]) => ({ id, rrf: s.rrf, cosine: s.cosine }));
}

/**
 * HYBRID search: it combines vector candidates (pgvector) and lexical ones (Postgres FTS,
 * 'spanish' configuration, which matches the corpus) and fuses them with Reciprocal Rank
 * Fusion (RRF). The lexical side brings precision on ids, proper nouns and jargon; the vector
 * side brings meaning.
 */
export async function hybridSearch(
  sql: Sql,
  provider: EmbeddingProvider,
  args: {
    queryText: string;
    projectId?: string | null;
    /**
     * Scoping by the set of ACCESSIBLE projects (a search with no concrete project). It only
     * applies when there is no `projectId` (a concrete project wins). An EMPTY array restricts
     * to ZERO rows (a user with no accessible projects gets nothing).
     */
    projectIds?: string[] | null;
    type?: MemoType;
    limit: number;
    excludeId?: string;
    includeArchived?: boolean;
    asOf?: Date;
    includeHistorical?: boolean;
  },
): Promise<SearchHit[]> {
  const pool = Math.max(args.limit * 4, 40);

  // Common filters (applied to both branches; the table is always aliased `m`).
  let filters = sql``;
  if (args.projectId) {
    filters = sql`${filters} AND m.project_id = ${args.projectId}`;
  } else if (args.projectIds) {
    // No concrete project but scoped to the accessible ones: restrict to that set.
    // An empty array -> `= ANY('{}')` matches nothing -> zero rows (fail-closed).
    filters = sql`${filters} AND m.project_id = ANY(${args.projectIds})`;
  }
  if (args.type) filters = sql`${filters} AND m.type = ${args.type}`;
  if (args.excludeId) filters = sql`${filters} AND m.id <> ${args.excludeId}`;
  if (!args.includeArchived) filters = sql`${filters} AND m.status NOT IN ('rejected', 'obsolete')`;
  if (args.asOf) {
    filters = sql`${filters} AND m.valid_from <= ${args.asOf} AND (m.valid_to IS NULL OR m.valid_to > ${args.asOf})`;
  } else if (!args.includeHistorical) {
    filters = sql`${filters} AND m.valid_to IS NULL`;
  }

  const vectors = await provider.embed([args.queryText]);
  const lit = toVectorLiteral(vectors[0]!);
  const vecRows = (await sql`
    SELECT m.id, (e.vector <=> ${lit}::vector) AS distance
    FROM embeddings e
    JOIN memos m ON m.id = e.memo_id
    WHERE e.embedding_model = ${provider.model} AND e.embedding_version = ${provider.version}
    ${filters}
    ORDER BY distance ASC
    LIMIT ${pool}
  `) as unknown as Row[];

  const ftsRows = (await sql`
    SELECT m.id, ts_rank(m.content_tsv, plainto_tsquery('spanish', ${args.queryText})) AS rank
    FROM memos m
    WHERE m.content_tsv @@ plainto_tsquery('spanish', ${args.queryText})
    ${filters}
    ORDER BY rank DESC
    LIMIT ${pool}
  `) as unknown as Row[];

  const ranked = rrfFuse(
    vecRows as unknown as { id: string; distance?: number | string }[],
    ftsRows as unknown as { id: string }[],
    args.limit,
  );
  if (ranked.length === 0) return [];
  // Hybrid NORMALISES the RRF by the maximum (the first one) to land it in [0,1].
  const maxRrf = ranked[0]!.rrf || 1;

  const ids = ranked.map((s) => s.id);
  const rows = (await sql`SELECT * FROM memos WHERE id IN ${sql(ids)}`) as unknown as Row[];
  const byId = new Map(rows.map((r) => [r.id as string, r]));

  return ranked
    .filter((s) => byId.has(s.id))
    .map((s) => ({
      entry: rowToMemo(byId.get(s.id)!),
      score: s.cosine ?? s.rrf / maxRrf,
    }));
}

/**
 * Semantic search by cosine similarity (pgvector `<=>`). It filters by the current embedding
 * model so that only vectors of the same dimension are compared.
 */
export async function vectorSearch(
  sql: Sql,
  provider: EmbeddingProvider,
  args: {
    queryText: string;
    projectId?: string | null;
    /**
     * Scoping by the set of ACCESSIBLE projects (a search with no concrete project). It only
     * applies when there is no `projectId`. An EMPTY array -> zero rows.
     */
    projectIds?: string[] | null;
    type?: MemoType;
    limit: number;
    excludeId?: string;
    includeArchived?: boolean;
    asOf?: Date;
    includeHistorical?: boolean;
  },
): Promise<SearchHit[]> {
  const vectors = await provider.embed([args.queryText]);
  const lit = toVectorLiteral(vectors[0]!);

  let where = sql`WHERE e.embedding_model = ${provider.model} AND e.embedding_version = ${provider.version}`;
  if (args.projectId) {
    where = sql`${where} AND m.project_id = ${args.projectId}`;
  } else if (args.projectIds) {
    // An empty array -> `= ANY('{}')` matches nothing -> zero rows (fail-closed).
    where = sql`${where} AND m.project_id = ANY(${args.projectIds})`;
  }
  if (args.type) where = sql`${where} AND m.type = ${args.type}`;
  if (args.excludeId) where = sql`${where} AND m.id <> ${args.excludeId}`;
  if (!args.includeArchived) where = sql`${where} AND m.status NOT IN ('rejected', 'obsolete')`;
  if (args.asOf) {
    where = sql`${where} AND m.valid_from <= ${args.asOf} AND (m.valid_to IS NULL OR m.valid_to > ${args.asOf})`;
  } else if (!args.includeHistorical) {
    where = sql`${where} AND m.valid_to IS NULL`;
  }

  const rows = (await sql`
    SELECT m.*, e.vector <=> ${lit}::vector AS distance
    FROM embeddings e
    JOIN memos m ON m.id = e.memo_id
    ${where}
    ORDER BY distance ASC
    LIMIT ${args.limit}
  `) as unknown as Row[];

  return rows.map((row) => ({
    entry: rowToMemo(row),
    score: 1 - Number(row.distance),
  }));
}

import { toVectorLiteral, type Sql } from "@cortex/database";
import type { EmbeddingProvider } from "@cortex/embeddings";
import type { ContextEntry, ContextEntryType } from "@cortex/shared";
import { rowToContextEntry, type Row } from "./map.js";

/** Guarda (o actualiza) el embedding de una entrada para el texto dado. */
export async function storeEmbedding(
  sql: Sql,
  provider: EmbeddingProvider,
  contextEntryId: string,
  text: string,
): Promise<void> {
  const vectors = await provider.embed([text]);
  const vec = vectors[0]!;
  await sql`
    INSERT INTO embeddings (context_entry_id, embedding_model, embedding_version, dim, vector, chunk_index)
    VALUES (${contextEntryId}, ${provider.model}, ${provider.version}, ${provider.dim},
            ${toVectorLiteral(vec)}::vector, 0)
    ON CONFLICT (context_entry_id, embedding_model, embedding_version, chunk_index)
    DO UPDATE SET vector = EXCLUDED.vector, dim = EXCLUDED.dim, created_at = now()
  `;
}

export interface SearchHit {
  entry: ContextEntry;
  /** Similitud coseno en [0,1] (1 = idéntico). */
  score: number;
}

/**
 * Búsqueda semántica por similitud coseno (pgvector `<=>`). Filtra por el modelo
 * de embedding actual para comparar solo vectores de la misma dimensión.
 */
export async function vectorSearch(
  sql: Sql,
  provider: EmbeddingProvider,
  args: {
    queryText: string;
    projectId?: string | null;
    type?: ContextEntryType;
    limit: number;
    excludeId?: string;
    /** Excluir entradas rechazadas/obsoletas por defecto. */
    includeArchived?: boolean;
  },
): Promise<SearchHit[]> {
  const vectors = await provider.embed([args.queryText]);
  const lit = toVectorLiteral(vectors[0]!);

  let where = sql`WHERE e.embedding_model = ${provider.model} AND e.embedding_version = ${provider.version}`;
  if (args.projectId) where = sql`${where} AND ce.project_id = ${args.projectId}`;
  if (args.type) where = sql`${where} AND ce.type = ${args.type}`;
  if (args.excludeId) where = sql`${where} AND ce.id <> ${args.excludeId}`;
  if (!args.includeArchived) where = sql`${where} AND ce.status NOT IN ('rejected', 'obsolete')`;

  const rows = (await sql`
    SELECT ce.*, e.vector <=> ${lit}::vector AS distance
    FROM embeddings e
    JOIN context_entries ce ON ce.id = e.context_entry_id
    ${where}
    ORDER BY distance ASC
    LIMIT ${args.limit}
  `) as unknown as Row[];

  return rows.map((row) => ({
    entry: rowToContextEntry(row),
    score: 1 - Number(row.distance),
  }));
}

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

/**
 * Genera y guarda embeddings por lotes (1 petición por lote). Respeta los límites
 * del proveedor (p.ej. nan: 60 rpm, 3 en paralelo) haciendo lotes secuenciales.
 */
export async function storeEmbeddingsBatch(
  sql: Sql,
  provider: EmbeddingProvider,
  rows: { contextEntryId: string; text: string }[],
  opts: { batchSize?: number; onProgress?: (done: number) => void } = {},
): Promise<void> {
  const batchSize = opts.batchSize ?? 32;
  for (let i = 0; i < rows.length; i += batchSize) {
    const chunk = rows.slice(i, i + batchSize);
    const vectors = await provider.embed(chunk.map((r) => r.text));
    for (let j = 0; j < chunk.length; j++) {
      const vec = vectors[j]!;
      await sql`
        INSERT INTO embeddings (context_entry_id, embedding_model, embedding_version, dim, vector, chunk_index)
        VALUES (${chunk[j]!.contextEntryId}, ${provider.model}, ${provider.version}, ${provider.dim},
                ${toVectorLiteral(vec)}::vector, 0)
        ON CONFLICT (context_entry_id, embedding_model, embedding_version, chunk_index)
        DO UPDATE SET vector = EXCLUDED.vector, dim = EXCLUDED.dim, created_at = now()
      `;
    }
    opts.onProgress?.(Math.min(i + batchSize, rows.length));
  }
}

export interface SearchHit {
  entry: ContextEntry;
  /** Relevancia en [0,1]. En híbrido es RRF normalizado; en vectorial, coseno. */
  score: number;
}

/**
 * Reciprocal Rank Fusion: fusiona una lista vectorial y una léxica (FTS) sumando
 * `1/(K+rank+1)` por posición en cada lista. La rama vectorial además conserva el
 * coseno (`1 - distance`). Devuelve la lista ordenada por RRF desc y cortada a
 * `limit`. Función PURA (sin BD): cada llamador decide luego cómo derivar su score
 * final a partir de `rrf`/`cosine` (p.ej. híbrido normaliza; código no).
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
 * Búsqueda HÍBRIDA: combina candidatos vectoriales (pgvector) y léxicos (FTS de
 * Postgres, config 'spanish') y los fusiona con Reciprocal Rank Fusion (RRF).
 * El léxico aporta precisión con IDs, nombres propios y jerga; el vector, sentido.
 */
export async function hybridSearch(
  sql: Sql,
  provider: EmbeddingProvider,
  args: {
    queryText: string;
    projectId?: string | null;
    /**
     * Scoping por conjunto de proyectos ACCESIBLES (búsqueda sin proyecto concreto).
     * Solo se aplica cuando NO hay `projectId` (un proyecto concreto manda). Un array
     * VACÍO restringe a CERO filas (usuario sin proyectos accesibles → nada).
     */
    projectIds?: string[] | null;
    type?: ContextEntryType;
    limit: number;
    excludeId?: string;
    includeArchived?: boolean;
    /** Consulta point-in-time: hechos válidos en esa fecha. */
    asOf?: Date;
    /** Incluir hechos ya invalidados (histórico/superseded). Por defecto false. */
    includeHistorical?: boolean;
  },
): Promise<SearchHit[]> {
  const pool = Math.max(args.limit * 4, 40);

  // Filtros comunes (se aplican a ambas ramas; tabla siempre aliasada `ce`).
  let filters = sql``;
  if (args.projectId) {
    filters = sql`${filters} AND ce.project_id = ${args.projectId}`;
  } else if (args.projectIds) {
    // Sin proyecto concreto pero con scoping de accesibles: restringe al conjunto.
    // Array vacío → `= ANY('{}')` no casa con nada → cero filas (fail-closed).
    filters = sql`${filters} AND ce.project_id = ANY(${args.projectIds})`;
  }
  if (args.type) filters = sql`${filters} AND ce.type = ${args.type}`;
  if (args.excludeId) filters = sql`${filters} AND ce.id <> ${args.excludeId}`;
  if (!args.includeArchived) filters = sql`${filters} AND ce.status NOT IN ('rejected', 'obsolete')`;
  if (args.asOf) {
    filters = sql`${filters} AND ce.valid_from <= ${args.asOf} AND (ce.valid_to IS NULL OR ce.valid_to > ${args.asOf})`;
  } else if (!args.includeHistorical) {
    filters = sql`${filters} AND ce.valid_to IS NULL`;
  }

  // Rama vectorial.
  const vectors = await provider.embed([args.queryText]);
  const lit = toVectorLiteral(vectors[0]!);
  const vecRows = (await sql`
    SELECT ce.id, (e.vector <=> ${lit}::vector) AS distance
    FROM embeddings e
    JOIN context_entries ce ON ce.id = e.context_entry_id
    WHERE e.embedding_model = ${provider.model} AND e.embedding_version = ${provider.version}
    ${filters}
    ORDER BY distance ASC
    LIMIT ${pool}
  `) as unknown as Row[];

  // Rama léxica (FTS).
  const ftsRows = (await sql`
    SELECT ce.id, ts_rank(ce.content_tsv, plainto_tsquery('spanish', ${args.queryText})) AS rank
    FROM context_entries ce
    WHERE ce.content_tsv @@ plainto_tsquery('spanish', ${args.queryText})
    ${filters}
    ORDER BY rank DESC
    LIMIT ${pool}
  `) as unknown as Row[];

  // Reciprocal Rank Fusion (fusión compartida en rrfFuse).
  const ranked = rrfFuse(
    vecRows as unknown as { id: string; distance?: number | string }[],
    ftsRows as unknown as { id: string }[],
    args.limit,
  );
  if (ranked.length === 0) return [];
  // El híbrido NORMALIZA el RRF por el máximo (el primero) para dejarlo en [0,1].
  const maxRrf = ranked[0]!.rrf || 1;

  const ids = ranked.map((s) => s.id);
  const rows = (await sql`SELECT * FROM context_entries WHERE id IN ${sql(ids)}`) as unknown as Row[];
  const byId = new Map(rows.map((r) => [r.id as string, r]));

  return ranked
    .filter((s) => byId.has(s.id))
    .map((s) => ({
      entry: rowToContextEntry(byId.get(s.id)!),
      score: s.cosine ?? s.rrf / maxRrf,
    }));
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
    /**
     * Scoping por conjunto de proyectos ACCESIBLES (búsqueda sin proyecto concreto).
     * Solo se aplica cuando NO hay `projectId`. Array VACÍO → cero filas.
     */
    projectIds?: string[] | null;
    type?: ContextEntryType;
    limit: number;
    excludeId?: string;
    /** Excluir entradas rechazadas/obsoletas por defecto. */
    includeArchived?: boolean;
    asOf?: Date;
    includeHistorical?: boolean;
  },
): Promise<SearchHit[]> {
  const vectors = await provider.embed([args.queryText]);
  const lit = toVectorLiteral(vectors[0]!);

  let where = sql`WHERE e.embedding_model = ${provider.model} AND e.embedding_version = ${provider.version}`;
  if (args.projectId) {
    where = sql`${where} AND ce.project_id = ${args.projectId}`;
  } else if (args.projectIds) {
    // Array vacío → `= ANY('{}')` no casa con nada → cero filas (fail-closed).
    where = sql`${where} AND ce.project_id = ANY(${args.projectIds})`;
  }
  if (args.type) where = sql`${where} AND ce.type = ${args.type}`;
  if (args.excludeId) where = sql`${where} AND ce.id <> ${args.excludeId}`;
  if (!args.includeArchived) where = sql`${where} AND ce.status NOT IN ('rejected', 'obsolete')`;
  if (args.asOf) {
    where = sql`${where} AND ce.valid_from <= ${args.asOf} AND (ce.valid_to IS NULL OR ce.valid_to > ${args.asOf})`;
  } else if (!args.includeHistorical) {
    where = sql`${where} AND ce.valid_to IS NULL`;
  }

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

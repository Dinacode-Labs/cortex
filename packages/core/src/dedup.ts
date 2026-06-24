import { getSql } from "@cortex/database";
import { getEmbeddingProvider } from "@cortex/embeddings";
import { storeEmbedding, vectorSearch } from "./vectors.js";
import type { Row } from "./map.js";

/**
 * Reconciliación de escritura (estilo mem0: ADD / UPDATE / NOOP). Antes de guardar
 * conocimiento auto-capturado, se busca lo más similar ya existente en el proyecto y se
 * decide: añadir (nuevo), fusionar (refina algo existente) o nada (redundante). Evita el
 * "context rot" / distractores (ver research/memory-capture-policy.md).
 *
 * Umbrales calibrados con qwen3-embedding (exacto ~0.99, paráfrasis ~0.84, distinto
 * ~0.67): por encima de UPDATE se reconcilia; por encima de NOOP es casi idéntico.
 */
export const UPDATE_THRESHOLD = Number(process.env.CORTEX_DEDUP_THRESHOLD ?? "0.82");
export const NOOP_THRESHOLD = Number(process.env.CORTEX_DEDUP_NOOP ?? "0.95");

export interface NearestEntry {
  id: string;
  title: string;
  content: string;
  score: number;
  sourceType: string;
}

async function findProjectId(project: string): Promise<string | null> {
  const rows = (await getSql()`SELECT id FROM entities WHERE type = 'project' AND name = ${project} LIMIT 1`) as unknown as Row[];
  return (rows[0]?.id as string) ?? null;
}

/** Entrada más similar del proyecto al texto dado (o null). */
export async function findNearest(project: string, text: string): Promise<NearestEntry | null> {
  const pid = await findProjectId(project);
  if (!pid) return null;
  try {
    const hits = await vectorSearch(getSql(), getEmbeddingProvider(), { queryText: text, projectId: pid, limit: 1 });
    const h = hits[0];
    if (!h) return null;
    return { id: h.entry.id, title: h.entry.title, content: h.entry.content, score: h.score, sourceType: h.entry.sourceType };
  } catch {
    return null;
  }
}

export async function isNearDuplicate(project: string, text: string, threshold = UPDATE_THRESHOLD): Promise<boolean> {
  const n = await findNearest(project, text);
  return n !== null && n.score >= threshold;
}

/** UPDATE: reemplaza el contenido de una entrada (resultado del merge) y re-embebe. */
export async function updateEntryContent(entryId: string, content: string): Promise<void> {
  const sql = getSql();
  await sql`UPDATE context_entries SET content = ${content}, updated_at = now() WHERE id = ${entryId}`;
  await storeEmbedding(sql, getEmbeddingProvider(), entryId, content);
}

/** DELETE bi-temporal (§5.5: invalidar ≠ borrar): marca la entrada como histórica y
 * superada por otra. Mismo patrón que la invalidación temporal. */
export async function invalidateEntry(entryId: string, supersededById: string): Promise<void> {
  await getSql()`
    UPDATE context_entries
    SET valid_to = now(), validity = 'historical', status = 'superseded', superseded_by = ${supersededById}
    WHERE id = ${entryId} AND valid_to IS NULL
  `;
}

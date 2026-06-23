import { getSql } from "@cortex/database";
import { getEmbeddingProvider } from "@cortex/embeddings";
import { vectorSearch } from "./vectors.js";
import type { Row } from "./map.js";

/**
 * Reconciliación de escritura (estilo mem0 ADD/NOOP): ¿el texto ya está cubierto por
 * conocimiento existente del proyecto? Se usa para NO capturar near-duplicates (evita
 * el "context rot" / distractores; ver research/memory-capture-policy.md). Umbral por
 * similitud coseno (score = 1 - distancia), configurable con CORTEX_DEDUP_THRESHOLD.
 */
// Calibrado con qwen3-embedding: exacto ~0.99, paráfrasis del mismo concepto ~0.84,
// conocimiento distinto-pero-relacionado ~0.67. 0.82 caza re-capturas (exacto+paráfrasis)
// sin descartar conocimiento genuinamente nuevo.
const DEFAULT_THRESHOLD = Number(process.env.CORTEX_DEDUP_THRESHOLD ?? "0.82");

export async function isNearDuplicate(project: string, text: string, threshold = DEFAULT_THRESHOLD): Promise<boolean> {
  const sql = getSql();
  const rows = (await sql`SELECT id FROM entities WHERE type = 'project' AND name = ${project} LIMIT 1`) as unknown as Row[];
  const projectId = (rows[0]?.id as string) ?? null;
  if (!projectId) return false; // proyecto nuevo: nada con que duplicar
  try {
    const hits = await vectorSearch(sql, getEmbeddingProvider(), { queryText: text, projectId, limit: 1 });
    return hits.length > 0 && hits[0]!.score >= threshold;
  } catch {
    return false; // ante fallo de embedding, no bloquear la captura
  }
}

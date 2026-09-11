import { getSql } from "@cortex/database";
import { getEmbeddingProvider } from "@cortex/embeddings";
import { getEnvNum } from "@cortex/shared";
import { storeEmbedding, vectorSearch } from "./vectors.js";
import { saveContext } from "./save.js";
import { findProjectIdByName } from "./projects.js";
import { relate } from "./entities.js";

/**
 * Reconciliación de escritura (estilo mem0: ADD / UPDATE / NOOP). Antes de guardar
 * conocimiento auto-capturado, se busca lo más similar ya existente en el proyecto y se
 * decide: añadir (nuevo), fusionar (refina algo existente) o nada (redundante). Evita el
 * "context rot" / distractores (ver research/memory-capture-policy.md).
 *
 * Umbrales calibrados con qwen3-embedding (exacto ~0.99, paráfrasis ~0.84, distinto
 * ~0.67): por encima de UPDATE se reconcilia; por encima de NOOP es casi idéntico.
 */
export const UPDATE_THRESHOLD = getEnvNum("CORTEX_DEDUP_THRESHOLD", 0.82);
export const NOOP_THRESHOLD = getEnvNum("CORTEX_DEDUP_NOOP", 0.95);

export interface NearestEntry {
  id: string;
  title: string;
  content: string;
  score: number;
  sourceType: string;
}

/** Entrada más similar del proyecto al texto dado (o null). */
export async function findNearest(project: string, text: string): Promise<NearestEntry | null> {
  const pid = await findProjectIdByName(getSql(), project);
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

// --- Reconciliación de escritura reutilizable (sesiones + conectores) --------

/** Reconciliador LLM inyectable (lo provee @cortex/agents vía setReconciler). Sin él, la
 * reconciliación es determinista: solo dedup de near-idénticos (sin merge/supersede). */
export interface ReconcilerHooks {
  decide: (existing: string, incoming: string) => Promise<"noop" | "update" | "supersede">;
  merge: (existing: string, incoming: string) => Promise<string>;
}
let reconciler: ReconcilerHooks | null = null;
export function setReconciler(hooks: ReconcilerHooks | null): void {
  reconciler = hooks;
}

export type ReconcileAction = "add" | "update" | "supersede" | "contradict" | "noop";
export interface ReconcileResult {
  action: ReconcileAction;
  /** Id de la entrada resultante: la nueva (add/supersede/contradict) o la existente
   * (noop/update). Siempre presente → los conectores pueden enlazar relaciones a él. */
  entryId: string;
}

/**
 * Guarda una pieza reconciliando contra lo existente (estilo mem0):
 *  - NOOP si ya hay algo near-idéntico (≥ NOOP_THRESHOLD), **venga de donde venga**. Dedup
 *    determinista, sin LLM. Reconocer que ya lo sabemos no toca nada, así que no hace falta
 *    exigir el mismo origen.
 *  - Con reconciliador inyectado, similitud 0.82–0.95 **y el mismo `sourceType`**: UPDATE
 *    (fusiona, solo lo auto-capturado), SUPERSEDE (invalida lo viejo auto-capturado; si es
 *    fuente o curado solo se marca `contradicts`) o NOOP. Aquí sí se exige el mismo origen,
 *    porque estas ramas MODIFICAN lo que ya había.
 *  - ADD en cualquier otro caso. NUNCA reescribe ni invalida conocimiento de fuente o curado.
 *
 * Queda un caso conocido: una PARÁFRASIS (~0.84) de algo capturado a mano se añade en vez de
 * fusionarse, porque cae en la banda de UPDATE y ahí sí manda el origen. Es deliberado —
 * fusionar automáticamente sobre lo que ha escrito una persona es peor— pero significa que
 * `lint` es quien tiene que sacar esos casi-duplicados a la luz.
 */
export async function saveWithReconciliation(
  input: Parameters<typeof saveContext>[0],
  opts?: Parameters<typeof saveContext>[1],
): Promise<ReconcileResult> {
  const near = input.project ? await findNearest(input.project, input.content) : null;
  const sameKind = !!near && near.sourceType === input.sourceType;

  // Casi idéntico: ya lo sabemos, venga de donde venga. RECONOCERLO es seguro siempre; lo
  // que no lo sería es MODIFICAR conocimiento curado, y de eso se encargan las ramas de
  // abajo, que sí exigen el mismo origen.
  //
  // Antes esto también exigía el mismo `sourceType`, y el efecto se veía usándolo: un agente
  // repite en su respuesta lo que la memoria le acaba de contar, la captura lo destila, y
  // como viene de "agent_session" nunca se compara con la entrada "manual" original. La
  // memoria se iba llenando de ecos de sí misma.
  if (near && near.score >= NOOP_THRESHOLD) return { action: "noop", entryId: near.id };

  if (near && sameKind && near.score >= UPDATE_THRESHOLD && reconciler) {
    const decision = await reconciler.decide(near.content, input.content);
    if (decision === "noop") return { action: "noop", entryId: near.id };
    if (decision === "supersede") {
      const { entry } = await saveContext(input, opts); // la nueva pasa a ser vigente
      if (near.sourceType === "agent_session") {
        await invalidateEntry(near.id, entry.id);
        return { action: "supersede", entryId: entry.id };
      }
      // Conocimiento de fuente/curado: no se invalida en automático, solo se marca.
      await relate(getSql(), { sourceId: entry.id, sourceType: "context_entry", targetId: near.id, targetType: "context_entry", relationType: "contradicts" });
      return { action: "contradict", entryId: entry.id };
    }
    // update: solo fusionamos entradas auto-capturadas (no reescribimos fuentes/curado)
    if (near.sourceType === "agent_session") {
      await updateEntryContent(near.id, await reconciler.merge(near.content, input.content));
      return { action: "update", entryId: near.id };
    }
  }

  const { entry } = await saveContext(input, opts);
  return { action: "add", entryId: entry.id };
}

/**
 * Reconciliación a posteriori (en `maintain`): dedup de entradas near-idénticas del MISMO
 * proyecto y `source_type`, reusando los embeddings ya calculados (sin coste de LLM ni
 * de re-embeber). Así los conectores (que embeben por lotes y no pueden inyectar el
 * reconciliador LLM) también se benefician. Mantiene la más antigua como canónica e
 * invalida (§5.5) las duplicadas (`superseded_by` la canónica). Reversible.
 */
// Formatos cuyo embedding NO es su identidad sino una descripción generada (caption de
// visión): captions genéricos agrupan imágenes DISTINTAS → nunca deduplicar por embedding.
const NON_DEDUP_FORMATS = ["png", "jpg", "jpeg", "gif", "webp", "bmp", "svg", "tif", "tiff"];

export async function reconcileProject(project: string, maxDistance = getEnvNum("CORTEX_DEDUP_MAX_DIST", 0.05)): Promise<{ deduped: number }> {
  const sql = getSql();
  const pid = await findProjectIdByName(sql, project);
  if (!pid) return { deduped: 0 };
  const pairs = (await sql`
    SELECT a.id AS keep, b.id AS drop
    FROM embeddings ea
    JOIN context_entries a ON a.id = ea.context_entry_id
    JOIN embeddings eb ON eb.embedding_model = ea.embedding_model
      AND eb.embedding_version = ea.embedding_version AND eb.chunk_index = ea.chunk_index
    JOIN context_entries b ON b.id = eb.context_entry_id
    WHERE a.project_id = ${pid} AND b.project_id = ${pid}
      AND a.source_type = b.source_type
      AND a.valid_to IS NULL AND b.valid_to IS NULL
      AND a.status NOT IN ('rejected', 'obsolete', 'superseded')
      AND b.status NOT IN ('rejected', 'obsolete', 'superseded')
      AND coalesce(a.metadata->>'format', '') <> ALL(${NON_DEDUP_FORMATS})
      AND coalesce(b.metadata->>'format', '') <> ALL(${NON_DEDUP_FORMATS})
      AND a.created_at < b.created_at
      AND (ea.vector <=> eb.vector) < ${maxDistance}
    ORDER BY b.created_at ASC
  `) as unknown as { keep: string; drop: string }[];
  const dropped = new Set<string>();
  let deduped = 0;
  for (const p of pairs) {
    if (dropped.has(p.drop) || dropped.has(p.keep)) continue; // ya tratado / la canónica fue invalidada
    await invalidateEntry(p.drop, p.keep);
    dropped.add(p.drop);
    deduped++;
  }
  return { deduped };
}

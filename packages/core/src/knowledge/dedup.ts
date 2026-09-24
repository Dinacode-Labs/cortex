import { getSql } from "@cortex/database";
import { getEmbeddingProvider } from "@cortex/embeddings";
import { getEnvNum } from "@cortex/shared";
import { storeEmbedding, vectorSearch } from "../storage/vectors.js";
import { saveContext } from "./save.js";
import { findProjectIdByName } from "../projects/projects.js";
import { relate } from "../graph/entities.js";

/**
 * Write reconciliation (mem0 style: ADD / UPDATE / NOOP). Before storing auto-captured
 * knowledge, the most similar existing entry in the project is looked up and a decision is
 * made: add (new), merge (it refines something existing) or nothing (redundant). It avoids
 * "context rot" / distractors (see research/memory-capture-policy.md).
 *
 * Thresholds calibrated with qwen3-embedding (exact ~0.99, paraphrase ~0.84, different
 * ~0.67): above UPDATE it reconciles; above NOOP it is near-identical.
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

/**
 * Records that an entry was CORROBORATED: the same knowledge arrived again and reconciliation
 * decided there was nothing to add (noop) or folded it in (update). It is the only signal
 * `autoCurate` promotes on (ADR-0067). Being WRITTEN to is not one: an entry gets reclassified,
 * re-embedded and corrected by hand without any of that making it truer.
 *
 * One statement rather than read-modify-write, because two sessions closing at the same time
 * would otherwise read the same value and store the same increment.
 */
export async function recordCorroboration(entryId: string): Promise<void> {
  await getSql()`
    UPDATE context_entries
       SET metadata = jsonb_set(metadata, '{corroborations}',
                                to_jsonb(cortex_corroborations(metadata) + 1))
     WHERE id = ${entryId}
  `;
}

export async function updateEntryContent(entryId: string, content: string): Promise<void> {
  const sql = getSql();
  await sql`UPDATE context_entries SET content = ${content}, updated_at = now() WHERE id = ${entryId}`;
  await storeEmbedding(sql, getEmbeddingProvider(), entryId, content);
}

/**
 * A one-off correction to an entry: title, content or both. Used by `PATCH /entries/:id`,
 * which is how an agent fixes something it stored badly itself.
 *
 * Only those two fields: type, confidence and validity are decided by reconciliation or by the
 * lint from the evidence, not by whoever calls the API. And when the content changes the
 * embedding is recomputed, because a corrected entry that can no longer be found is worse than
 * the uncorrected one.
 */
export async function updateEntryFields(
  entryId: string,
  fields: { title?: string; content?: string },
): Promise<boolean> {
  const { title, content } = fields;
  if (title === undefined && content === undefined) return false;
  const sql = getSql();
  const rows = (await sql`
    UPDATE context_entries
       SET title = COALESCE(${title ?? null}, title),
           content = COALESCE(${content ?? null}, content),
           updated_at = now()
     WHERE id = ${entryId}
     RETURNING id
  `) as unknown as { id: string }[];
  if (rows.length === 0) return false;
  if (content !== undefined) await storeEmbedding(sql, getEmbeddingProvider(), entryId, content);
  return true;
}

/** Bi-temporal DELETE (section 5.5: invalidating is not deleting): marks the entry as
 * historical and superseded by another. The same pattern as temporal invalidation. */
export async function invalidateEntry(entryId: string, supersededById: string): Promise<void> {
  await getSql()`
    UPDATE context_entries
    SET valid_to = now(), validity = 'historical', status = 'superseded', superseded_by = ${supersededById}
    WHERE id = ${entryId} AND valid_to IS NULL
  `;
}

/** Injectable LLM reconciler (provided by @cortex/agents through setReconciler). Without it,
 * reconciliation is deterministic: near-identical dedup only (no merge/supersede). */
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
  /** Id of the resulting entry: the new one (add/supersede/contradict) or the existing one
   * (noop/update). Always present -> connectors can attach relations to it. */
  entryId: string;
}

/**
 * Stores a piece while reconciling against what exists (mem0 style):
 *  - NOOP when something near-identical already exists (>= NOOP_THRESHOLD), **whatever its
 *    origin**. Deterministic dedup, no LLM. Acknowledging that we already know it changes
 *    nothing of what the entry says, so there is no need to demand the same origin.
 *  - With a reconciler injected, similarity 0.82-0.95 **and the same `sourceType`**: UPDATE
 *    (merge, auto-captured only), SUPERSEDE (invalidate the old auto-captured one; if it is
 *    sourced or curated it is only marked `contradicts`) or NOOP. Here the same origin IS
 *    required, because these branches MODIFY what was already there.
 *  - ADD in every other case. It NEVER rewrites or invalidates sourced or curated knowledge.
 *
 * Every branch that does NOT add a new entry -- the three noops and the merge -- counts as a
 * corroboration of the entry that was already there (`recordCorroboration`), which is what
 * auto-curation later promotes on.
 *
 * One known case remains: a PARAPHRASE (~0.84) of something captured by hand is added rather
 * than merged, because it lands in the UPDATE band where origin rules. That is deliberate --
 * automatically merging over what a person wrote is worse -- but it means `lint` is what has
 * to bring those near-duplicates to light.
 */
export async function saveWithReconciliation(
  input: Parameters<typeof saveContext>[0],
  opts?: Parameters<typeof saveContext>[1],
): Promise<ReconcileResult> {
  const near = input.project ? await findNearest(input.project, input.content) : null;
  const sameKind = !!near && near.sourceType === input.sourceType;

  // Near-identical: we already know it, whatever its origin. ACKNOWLEDGING it is always safe;
  // what would not be is MODIFYING curated knowledge, and the branches below handle that --
  // they do require the same origin.
  //
  // This used to demand the same `sourceType` too, and the effect showed up in use: an agent
  // repeats in its answer what the memory just told it, capture distills that, and since it
  // comes from "agent_session" it is never compared against the original "manual" entry. The
  // memory kept filling up with echoes of itself.
  if (near && near.score >= NOOP_THRESHOLD) {
    await recordCorroboration(near.id);
    return { action: "noop", entryId: near.id };
  }

  // The same knowledge by TWO routes: the agent stores it with the tool and, on closing the
  // session, distillation stores it again. They arrive with different `sourceType`s ("manual"
  // and "agent_session"), so the branches below -- which require the same origin so as not to
  // rewrite curated knowledge -- never look at it, and the 0.95 above is not reached: measured
  // on a project with several agents at work, this echo scores 0.86-0.88.
  //
  // So the reconciler is asked, but ONLY in order not to write. Across different origins
  // nothing is ever modified or invalidated: the worst that can happen is that the entry is not
  // added because we already knew it, which is exactly what is wanted.
  if (near && !sameKind && near.score >= UPDATE_THRESHOLD && reconciler) {
    if ((await reconciler.decide(near.content, input.content)) === "noop") {
      await recordCorroboration(near.id);
      return { action: "noop", entryId: near.id };
    }
  }

  if (near && sameKind && near.score >= UPDATE_THRESHOLD && reconciler) {
    const decision = await reconciler.decide(near.content, input.content);
    if (decision === "noop") {
      await recordCorroboration(near.id);
      return { action: "noop", entryId: near.id };
    }
    if (decision === "supersede") {
      const { entry } = await saveContext(input, opts);
      if (near.sourceType === "agent_session") {
        await invalidateEntry(near.id, entry.id);
        return { action: "supersede", entryId: entry.id };
      }
      // Sourced/curated knowledge: never invalidated automatically, only flagged.
      await relate(getSql(), { sourceId: entry.id, sourceType: "context_entry", targetId: near.id, targetType: "context_entry", relationType: "contradicts" });
      return { action: "contradict", entryId: entry.id };
    }
    // update: only auto-captured entries are merged (sourced/curated is never rewritten)
    if (near.sourceType === "agent_session") {
      await updateEntryContent(near.id, await reconciler.merge(near.content, input.content));
      await recordCorroboration(near.id);
      return { action: "update", entryId: near.id };
    }
  }

  const { entry } = await saveContext(input, opts);
  return { action: "add", entryId: entry.id };
}

/**
 * After-the-fact reconciliation (inside `maintain`): dedup of near-identical entries from the
 * SAME project and `source_type`, reusing the embeddings already computed (no LLM cost and no
 * re-embedding). That way the connectors (which embed in batches and cannot inject the LLM
 * reconciler) benefit too. It keeps the oldest as canonical and invalidates (section 5.5) the
 * duplicates (`superseded_by` the canonical one). Reversible.
 */
// Formats whose embedding is NOT their identity but a generated description (a vision
// caption): generic captions group DIFFERENT images together -> never dedup them by embedding.
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
    if (dropped.has(p.drop) || dropped.has(p.keep)) continue; // already handled / the canonical one was invalidated
    await invalidateEntry(p.drop, p.keep);
    dropped.add(p.drop);
    deduped++;
  }
  return { deduped };
}

import { getSql } from "@cortex/database";
import { getEmbeddingProvider } from "@cortex/embeddings";
import { saveContext } from "./save.js";
import { storeEmbeddingsBatch } from "./vectors.js";
import { findProjectIdByName } from "./projects.js";
import { relate } from "./entities.js";
import { type BatchItem, type RelationType, scrub } from "@cortex/shared";

export type { BatchItem };
import type { Row } from "./map.js";

/**
 * BATCH capture for connectors (through the authenticated API). It keeps ingestion in 2
 * phases: store without an embedding, then index in batches at the end (which respects the
 * provider's limits). Incremental by `sourceReference` (it skips what was already ingested).
 * Attribution comes from `createdBy`.
 *
 * Classification: by default items enter with a HEURISTIC type (cheap, no LLM) -- the
 * intelligence (graph, reconcile, curation) is applied later by `cortex maintain`. With
 * `CORTEX_CAPTURE_LLM=1` every item is classified with the LLM at ingest time (a reliable
 * type: decisions/constraints/risks properly typed), at the cost of 1 LLM call per item. An
 * explicit `type` from the connector (e.g. `pr_summary`) always beats the LLM.
 */
export interface BatchItemResult {
  ref: string | null;
  id: string;
  action: "added" | "existing";
}

export async function captureBatch(projectName: string, items: BatchItem[], createdBy: string): Promise<BatchItemResult[]> {
  const useClassifier = process.env.CORTEX_CAPTURE_LLM === "1";
  const sql = getSql();
  const projectId = await findProjectIdByName(sql, projectName);
  if (!projectId) throw new Error(`Project not found: ${projectName}`);

  const results: BatchItemResult[] = [];
  const toEmbed: { contextEntryId: string; text: string }[] = [];
  for (const rawItem of items) {
    // Scrubbed here and not only inside `saveContext` because the embedding text (`toEmbed`)
    // is built from the item, not from the persisted entry.
    const it = {
      ...rawItem,
      content: scrub(rawItem.content),
      title: rawItem.title ? scrub(rawItem.title) : rawItem.title,
    };
    if (it.sourceReference) {
      const ex = (await sql`SELECT id FROM context_entries WHERE project_id = ${projectId} AND source_reference = ${it.sourceReference} LIMIT 1`) as unknown as Row[];
      if (ex[0]) {
        results.push({ ref: it.sourceReference, id: ex[0].id as string, action: "existing" });
        continue;
      }
    }
    const { entry } = await saveContext(
      {
        content: it.content,
        project: projectName,
        title: it.title,
        type: (it.type as never) || undefined,
        confidence: (it.confidence as never) || "medium",
        sourceType: (it.sourceType as never) || "manual",
        sourceReference: it.sourceReference,
        createdBy,
        metadata: it.metadata,
      } as never,
      { useClassifier, detectImprovements: false, skipEmbedding: true },
    );
    toEmbed.push({ contextEntryId: entry.id, text: `${it.title ?? ""}\n\n${it.content}` });
    results.push({ ref: it.sourceReference ?? null, id: entry.id, action: "added" });
  }
  if (toEmbed.length) await storeEmbeddingsBatch(sql, getEmbeddingProvider(), toEmbed, { batchSize: 32 });
  return results;
}

/** Creates a relation between entries (e.g. an attachment `belongs_to` its Notion page). */
export async function relateEntries(sourceId: string, targetId: string, relationType: RelationType): Promise<void> {
  await relate(getSql(), { sourceId, sourceType: "context_entry", targetId, targetType: "context_entry", relationType });
}

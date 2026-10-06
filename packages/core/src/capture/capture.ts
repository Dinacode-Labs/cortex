import { saveContext } from "../knowledge/application/save.js";
import { findProjectIdByName } from "../projects/application/projects.js";
import { relate } from "../graph/application/entities.js";
import { type BatchItem, type RelationType, scrub } from "@cortex/shared";
import { port } from "../composition.js";

export type { BatchItem };

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
  const projectId = await findProjectIdByName(projectName);
  if (!projectId) throw new Error(`Project not found: ${projectName}`);
  const repository = port("memos");

  const results: BatchItemResult[] = [];
  const toEmbed: { memoId: string; text: string }[] = [];
  for (const rawItem of items) {
    // Scrubbed here and not only inside `saveContext` because the embedding text (`toEmbed`)
    // is built from the item, not from the persisted entry.
    const it = {
      ...rawItem,
      content: scrub(rawItem.content),
      title: rawItem.title ? scrub(rawItem.title) : rawItem.title,
    };
    if (it.sourceReference) {
      const existingId = await repository.findIdBySourceReference(projectId, it.sourceReference);
      if (existingId) {
        results.push({ ref: it.sourceReference, id: existingId, action: "existing" });
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
    toEmbed.push({ memoId: entry.id, text: `${it.title ?? ""}\n\n${it.content}` });
    results.push({ ref: it.sourceReference ?? null, id: entry.id, action: "added" });
  }
  if (toEmbed.length) await port("memoIndex").indexMany(toEmbed, { batchSize: 32 });
  return results;
}

export async function relateEntries(sourceId: string, targetId: string, relationType: RelationType): Promise<void> {
  await relate({ sourceId, sourceType: "memo", targetId, targetType: "memo", relationType });
}

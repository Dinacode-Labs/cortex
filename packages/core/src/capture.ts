import { getSql } from "@cortex/database";
import { getEmbeddingProvider } from "@cortex/embeddings";
import { saveContext } from "./save.js";
import { storeEmbeddingsBatch } from "./vectors.js";
import { findProjectIdByName } from "./projects.js";
import { relate } from "./entities.js";
import { type RelationType, scrub } from "@cortex/shared";
import type { Row } from "./map.js";

/**
 * Captura por LOTES para conectores (vía API autenticada). Conserva la ingesta en 2 fases:
 * guarda sin embedding e indexa por lotes al final (respeta los límites del proveedor).
 * Incremental por `sourceReference` (salta lo ya ingerido). Atribuye con `createdBy`.
 *
 * Clasificación: por defecto los items entran con tipo por HEURÍSTICA (barato, sin LLM) —
 * la inteligencia (grafo, reconcile, curación) la aplica luego `cortex maintain`. Con
 * `CORTEX_CAPTURE_LLM=1` se clasifica cada item con el LLM ya en la ingesta (tipo fiable:
 * decisiones/constraints/riesgos bien tipados), a cambio de 1 llamada LLM por item. Un
 * `type` explícito del conector (p.ej. `pr_summary`) siempre gana al LLM (precedencia).
 */
export interface BatchItem {
  title?: string;
  content: string;
  type?: string;
  sourceType?: string;
  sourceReference?: string;
  confidence?: string;
  metadata?: Record<string, unknown>;
}
export interface BatchItemResult {
  ref: string | null;
  id: string;
  action: "added" | "existing";
}

export async function captureBatch(projectName: string, items: BatchItem[], createdBy: string): Promise<BatchItemResult[]> {
  const useClassifier = process.env.CORTEX_CAPTURE_LLM === "1";
  const sql = getSql();
  const projectId = await findProjectIdByName(sql, projectName);
  if (!projectId) throw new Error(`Proyecto no encontrado: ${projectName}`);

  const results: BatchItemResult[] = [];
  const toEmbed: { contextEntryId: string; text: string }[] = [];
  for (const rawItem of items) {
    // Escrubado aquí y no solo dentro de `saveContext` porque el texto del embedding
    // (`toEmbed`) se construye a partir del item, no de la entrada persistida.
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

/** Crea una relación entre entradas (p.ej. adjunto `belongs_to` su página de Notion). */
export async function relateEntries(sourceId: string, targetId: string, relationType: RelationType): Promise<void> {
  await relate(getSql(), { sourceId, sourceType: "context_entry", targetId, targetType: "context_entry", relationType });
}

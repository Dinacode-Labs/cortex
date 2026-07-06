import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { getSql } from "@cortex/database";
import { getEmbeddingProvider } from "@cortex/embeddings";
import { getEnvNum } from "@cortex/shared";
import type { ConfidenceLevel, ContextEntryType, SourceType } from "@cortex/shared";
import { registerUsageSink, saveContext, storeEmbeddingsBatch } from "@cortex/core";

/**
 * Ingesta masiva de contexto desde un fichero JSON (array de items) hacia un
 * proyecto. Dos fases para respetar los límites del proveedor de embeddings:
 *   1) Persistir entradas SIN embedding (solo BD, rápido).
 *   2) Generar embeddings por LOTES (pocas peticiones; nan: 60 rpm, 3 paralelas).
 *
 * Uso: cortex ingest "<Proyecto>" <items.json>
 * Env: CORTEX_INGEST_LLM=1 para clasificar cada item con LLM (más lento).
 */

interface IngestItem {
  content: string;
  title?: string;
  type?: ContextEntryType;
  confidence?: ConfidenceLevel;
  sourceType?: SourceType;
  sourceReference?: string;
  createdBy?: string;
  metadata?: Record<string, unknown>;
}

const USE_LLM = process.env.CORTEX_INGEST_LLM === "1";
const PHASE1_CONCURRENCY = getEnvNum("CORTEX_INGEST_CONCURRENCY", 8);
const EMBED_BATCH = Number(process.env.CORTEX_EMBED_BATCH ?? "32");

export async function run(args: string[]): Promise<void> {
  registerUsageSink();
  const project = args[0];
  const file = args[1];
  if (!project || !file) {
    console.error('Uso: cortex ingest "<Proyecto>" <items.json>');
    process.exitCode = 1;
    return;
  }

  const items = JSON.parse(readFileSync(resolve(file), "utf8")) as IngestItem[];
  console.log(`Ingestando ${items.length} items en "${project}" (llm=${USE_LLM})...`);

  // --- Fase 1: persistir entradas sin embedding (solo BD) ---
  const toEmbed: { contextEntryId: string; text: string }[] = [];
  let done = 0;
  let failed = 0;
  let cursor = 0;

  async function worker(): Promise<void> {
    while (cursor < items.length) {
      const item = items[cursor++]!;
      try {
        const { entry } = await saveContext(
          {
            content: item.content,
            project,
            title: item.title,
            type: item.type,
            confidence: item.confidence,
            sourceType: item.sourceType,
            sourceReference: item.sourceReference,
            createdBy: item.createdBy ?? "ingest",
            metadata: item.metadata,
          },
          { useClassifier: USE_LLM, detectImprovements: false, skipEmbedding: true },
        );
        toEmbed.push({ contextEntryId: entry.id, text: `${entry.title}\n\n${entry.content}` });
      } catch (e) {
        failed++;
        console.error(`  ✗ ${item.sourceReference ?? ""}: ${(e as Error).message}`);
      }
      done++;
      if (done % 50 === 0 || done === items.length) console.log(`  fase 1: ${done}/${items.length}`);
    }
  }
  await Promise.all(Array.from({ length: PHASE1_CONCURRENCY }, () => worker()));
  console.log(`Fase 1 ok: ${toEmbed.length} entradas (${failed} fallos).`);

  // --- Fase 2: embeddings por lotes ---
  console.log(`Fase 2: generando embeddings por lotes de ${EMBED_BATCH}...`);
  await storeEmbeddingsBatch(getSql(), getEmbeddingProvider(), toEmbed, {
    batchSize: EMBED_BATCH,
    onProgress: (d) => console.log(`  fase 2: ${d}/${toEmbed.length}`),
  });
  console.log("Ingesta completada.");
}



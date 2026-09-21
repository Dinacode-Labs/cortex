import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { getSql } from "@cortex/database";
import { getEmbeddingProvider } from "@cortex/embeddings";
import { getEnvNum } from "@cortex/shared";
import type { ConfidenceLevel, ContextEntryType, SourceType } from "@cortex/shared";
import { registerUsageSink, saveContext, storeEmbeddingsBatch } from "@cortex/core";

/**
 * Bulk context ingestion from a JSON file (an array of items) into a project. Two phases, to
 * respect the embedding provider's limits:
 *   1) Persist entries WITHOUT an embedding (database only, fast).
 *   2) Generate embeddings in BATCHES (few requests; providers typically cap rpm and
 *      parallelism).
 *
 * Usage: cortex-admin ingest "<Project>" <items.json>
 * Env: CORTEX_INGEST_LLM=1 to classify each item with the LLM (slower).
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
    console.error('Usage: cortex-admin ingest "<Project>" <items.json>');
    process.exitCode = 1;
    return;
  }

  const items = JSON.parse(readFileSync(resolve(file), "utf8")) as IngestItem[];
  console.log(`Ingesting ${items.length} items into "${project}" (llm=${USE_LLM})...`);

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
      if (done % 50 === 0 || done === items.length) console.log(`  phase 1: ${done}/${items.length}`);
    }
  }
  await Promise.all(Array.from({ length: PHASE1_CONCURRENCY }, () => worker()));
  console.log(`Phase 1 done: ${toEmbed.length} entries (${failed} failed).`);

  console.log(`Phase 2: generating embeddings in batches of ${EMBED_BATCH}...`);
  await storeEmbeddingsBatch(getSql(), getEmbeddingProvider(), toEmbed, {
    batchSize: EMBED_BATCH,
    onProgress: (d) => console.log(`  phase 2: ${d}/${toEmbed.length}`),
  });
  console.log("Ingestion finished.");
}



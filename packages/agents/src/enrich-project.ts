import { getSql } from "@cortex/database";
import { linkEntryToEntity, listEntries, relate, resolveEntity } from "@cortex/core";
import { extractGraph } from "./enrich.js";

/**
 * Pase de enriquecimiento de grafo (§7/§12.4) de un proyecto: extrae entidades +
 * relaciones con el LLM y construye el grafo. Idempotente (find-or-create + relate
 * dedup). Reutilizable desde el CLI (`enrich-run`) y el mantenimiento (`maintain`).
 */

const CONCURRENCY = Number(process.env.CORTEX_ENRICH_CONCURRENCY ?? "3");

export interface EnrichResult {
  processed: number;
  entities: number;
  relations: number;
  failed: number;
  skipped: number;
}

export async function enrichProject(
  project: string,
  opts: { onlyMissing?: boolean; limit?: number; onProgress?: (done: number, total: number) => void } = {},
): Promise<EnrichResult> {
  const sql = getSql();
  let entries = await listEntries({ project, limit: opts.limit ?? 2000 });
  let skipped = 0;

  if (opts.onlyMissing) {
    const enriched = new Set(
      ((await sql`
        SELECT DISTINCT cee.context_entry_id AS id
        FROM context_entry_entities cee
        JOIN entities en ON en.id = cee.entity_id AND en.type <> 'project'
      `) as unknown as { id: string }[]).map((r) => r.id),
    );
    const before = entries.length;
    entries = entries.filter((e) => !enriched.has(e.id));
    skipped = before - entries.length;
  }

  let cursor = 0;
  let done = 0;
  let nEnt = 0;
  let nRel = 0;
  let failed = 0;

  async function worker(): Promise<void> {
    while (cursor < entries.length) {
      const e = entries[cursor++]!;
      try {
        const g = await extractGraph(e.content);
        if (g) {
          const nameToId = new Map<string, string>();
          for (const ent of g.entities) {
            const resolved = await resolveEntity(sql, ent.name, ent.type);
            nameToId.set(ent.name.toLowerCase(), resolved.id);
            await linkEntryToEntity(sql, e.id, resolved.id);
            nEnt++;
          }
          for (const rel of g.relations) {
            const isEntry = rel.source.toUpperCase() === "ENTRADA";
            const sourceId = isEntry ? e.id : nameToId.get(rel.source.toLowerCase());
            const targetId = nameToId.get(rel.target.toLowerCase());
            if (!sourceId || !targetId || sourceId === targetId) continue;
            await relate(sql, {
              sourceId,
              sourceType: isEntry ? "context_entry" : "entity",
              targetId,
              targetType: "entity",
              relationType: rel.type,
            });
            nRel++;
          }
        } else {
          failed++;
        }
      } catch (err) {
        failed++;
        console.error(`  ✗ ${e.sourceReference ?? e.id}: ${(err as Error).message}`);
      }
      done++;
      opts.onProgress?.(done, entries.length);
    }
  }

  await Promise.all(Array.from({ length: CONCURRENCY }, () => worker()));
  return { processed: done, entities: nEnt, relations: nRel, failed, skipped };
}

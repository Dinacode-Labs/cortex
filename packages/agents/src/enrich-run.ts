import { closeSql, getSql } from "@cortex/database";
import { linkEntryToEntity, listEntries, relate, resolveEntity } from "@cortex/core";
import { extractGraph } from "./enrich.js";

/**
 * Pase de enriquecimiento de grafo (§7/§12.4): recorre las entradas de un proyecto,
 * extrae entidades de dominio + relaciones con el LLM, resuelve a canónicas (dedup
 * por nombre canónico) y construye el grafo. Idempotente (find-or-create + relate
 * dedup), re-ejecutable.
 *
 * Uso: tsx src/enrich-run.ts "<Proyecto>" [limite]   (limite = muestra)
 */

const CONCURRENCY = Number(process.env.CORTEX_ENRICH_CONCURRENCY ?? "3");

async function main(): Promise<void> {
  const project = process.argv[2];
  const limit = Number(process.argv[3] ?? "0") || undefined;
  if (!project) {
    console.error('Uso: tsx src/enrich-run.ts "<Proyecto>" [limite]');
    process.exitCode = 1;
    return;
  }
  const sql = getSql();
  let entries = await listEntries({ project, limit: limit ?? 2000 });

  // Modo reanudar: salta las entradas que ya tienen alguna entidad (no-proyecto).
  if (process.env.CORTEX_ENRICH_ONLY_MISSING === "1") {
    const enriched = new Set(
      ((await sql`
        SELECT DISTINCT cee.context_entry_id AS id
        FROM context_entry_entities cee
        JOIN entities en ON en.id = cee.entity_id AND en.type <> 'project'
      `) as unknown as { id: string }[]).map((r) => r.id),
    );
    const before = entries.length;
    entries = entries.filter((e) => !enriched.has(e.id));
    console.log(`Reanudar: ${before - entries.length} ya enriquecidas, ${entries.length} pendientes.`);
  }

  console.log(`Enriqueciendo ${entries.length} entradas de "${project}" (conc=${CONCURRENCY})...`);

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
      if (done % 10 === 0 || done === entries.length) {
        console.log(`  ${done}/${entries.length} · +${nEnt} entidades · +${nRel} relaciones · ${failed} fallos`);
      }
    }
  }

  await Promise.all(Array.from({ length: CONCURRENCY }, () => worker()));
  console.log(`Enriquecimiento completado: +${nEnt} enlaces de entidad, +${nRel} relaciones, ${failed} fallos.`);
}

main()
  .catch((e) => {
    console.error("Error en enriquecimiento:", e);
    process.exitCode = 1;
  })
  .finally(() => closeSql());

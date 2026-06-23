import { closeSql, getSql } from "@cortex/database";
import type { Row } from "./map.js";

/**
 * Loop de resolución de entidades (§12.4): fusiona variantes de una misma entidad
 * (p.ej. "Acme"/"Acme Corp"/"acme.com") en una canónica, re-apuntando enlaces
 * (context_entry_entities) y relaciones, y deduplicando. Solo BD, sin LLM.
 *
 * Agrupa por nombre normalizado (sin acentos/puntuación, minúsculas) entre todos
 * los tipos salvo `project` (nunca se fusiona/borra un proyecto). La canónica es
 * la entidad con más enlaces (desempate: nombre más descriptivo).
 *
 * Uso: tsx src/resolve-entities.ts
 */

function norm(s: string): string {
  return s
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "");
}

export interface ResolveResult {
  groups: number;
  merged: number;
}

export async function resolveEntities(): Promise<ResolveResult> {
  const sql = getSql();

  const entities = (await sql`SELECT id, name, type FROM entities WHERE type <> 'project'`) as unknown as Row[];
  const linkCounts = new Map<string, number>();
  for (const r of (await sql`SELECT entity_id, count(*)::int AS n FROM context_entry_entities GROUP BY entity_id`) as unknown as Row[]) {
    linkCounts.set(r.entity_id, Number(r.n));
  }

  // Agrupar por nombre normalizado.
  const groups = new Map<string, Row[]>();
  for (const e of entities) {
    const key = norm(e.name);
    if (key.length < 3) continue;
    let bucket = groups.get(key);
    if (!bucket) {
      bucket = [];
      groups.set(key, bucket);
    }
    bucket.push(e);
  }

  let merged = 0;
  let groupsMerged = 0;
  for (const [, group] of groups) {
    if (group.length < 2) continue;
    // Canónica: más enlaces, desempate por nombre más largo (más descriptivo).
    group.sort((a, b) => {
      const d = (linkCounts.get(b.id) ?? 0) - (linkCounts.get(a.id) ?? 0);
      return d !== 0 ? d : b.name.length - a.name.length;
    });
    const canonical = group[0]!;
    const losers = group.slice(1);

    await sql.begin(async (tx) => {
      for (const x of losers) {
        // Re-apuntar enlaces sin violar PK (entry, entity).
        await tx`
          UPDATE context_entry_entities cee SET entity_id = ${canonical.id}
          WHERE cee.entity_id = ${x.id}
            AND NOT EXISTS (
              SELECT 1 FROM context_entry_entities c2
              WHERE c2.context_entry_id = cee.context_entry_id AND c2.entity_id = ${canonical.id})
        `;
        await tx`DELETE FROM context_entry_entities WHERE entity_id = ${x.id}`;
        // Re-apuntar relaciones.
        await tx`UPDATE relations SET source_id = ${canonical.id} WHERE source_id = ${x.id}`;
        await tx`UPDATE relations SET target_id = ${canonical.id} WHERE target_id = ${x.id}`;
        await tx`DELETE FROM entities WHERE id = ${x.id}`;
        merged++;
      }
    });
    groupsMerged++;
  }

  // Dedup de relaciones y eliminación de auto-relaciones tras la fusión.
  await sql`DELETE FROM relations WHERE source_id = target_id`;
  await sql`
    DELETE FROM relations a USING relations b
    WHERE a.id > b.id AND a.source_id = b.source_id
      AND a.target_id = b.target_id AND a.relation_type = b.relation_type
  `;

  return { groups: groupsMerged, merged };
}

// CLI: solo si se ejecuta directamente (no al importar la función).
if (import.meta.url === `file://${process.argv[1]}`) {
  resolveEntities()
    .then((r) => console.log(`Resolución de entidades: ${r.groups} grupos, ${r.merged} variantes fusionadas.`))
    .catch((e) => {
      console.error("Error en resolución de entidades:", e);
      process.exitCode = 1;
    })
    .finally(() => closeSql());
}

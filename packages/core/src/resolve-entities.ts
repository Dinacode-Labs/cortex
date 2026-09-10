import { getSql } from "@cortex/database";
import type { Row } from "./map.js";
import { canonicalize } from "./text.js";

/**
 * Loop de resolución de entidades (§12.4): fusiona variantes de una misma entidad
 * (p.ej. "Acme"/"Acme Corp"/"acme.com") en una canónica, re-apuntando enlaces
 * (context_entry_entities) y relaciones, y deduplicando. Solo BD, sin LLM.
 *
 * Agrupa por TIPO + nombre normalizado (sin acentos/puntuación, minúsculas), excluyendo
 * `project` (nunca se fusiona/borra un proyecto). El tipo forma parte de la clave a
 * propósito: dos entidades homónimas de tipos distintos son cosas distintas (el `vendor`
 * "Stripe" y el `service` "Stripe" no deben colapsar en una sola).
 *
 * La canónica es la entidad con más enlaces; desempates: nombre más descriptivo (más
 * largo) y, si aún empatan, el `id` menor — para que el resultado sea DETERMINISTA y no
 * dependa del orden en que Postgres devuelva las filas.
 */

// Normalización sobre la base canónica compartida (NFD + sin diacríticos +
// minúsculas + trim + colapsa espacios) y además quita todo lo no alfanumérico.
function norm(s: string): string {
  return canonicalize(s).replace(/[^a-z0-9]+/g, "");
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

  // Agrupar por tipo + nombre normalizado.
  const groups = new Map<string, Row[]>();
  for (const e of entities) {
    const normalized = norm(e.name);
    if (normalized.length < 3) continue;
    const key = `${e.type}:${normalized}`;
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
    // Canónica: más enlaces; desempates por nombre más largo (más descriptivo) y, en
    // último término, por id — sin este último el ganador depende del orden de filas
    // que devuelva Postgres y la fusión deja de ser reproducible.
    group.sort((a, b) => {
      const byLinks = (linkCounts.get(b.id) ?? 0) - (linkCounts.get(a.id) ?? 0);
      if (byLinks !== 0) return byLinks;
      const byLength = b.name.length - a.name.length;
      if (byLength !== 0) return byLength;
      return String(a.id).localeCompare(String(b.id));
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
        // Re-apuntar relaciones sin violar el UNIQUE parcial `relations_active_unique`
        // (source_id, target_id, relation_type) WHERE valid_to IS NULL. Cada UPDATE re-apunta
        // SOLO las aristas del loser que, tras mover el extremo a `canonical`, NO colisionarían
        // con una arista ya vigente; el DELETE posterior elimina las que sí habrían chocado.
        // Hay que tratar source_id y target_id por separado: una arista del loser puede colisionar
        // por cualquiera de los dos extremos según cuál se re-apunte.

        // (a) Re-apuntar source_id: la arista (x.id, target, type) pasa a (canonical.id, target, type).
        await tx`
          UPDATE relations r SET source_id = ${canonical.id}
          WHERE r.source_id = ${x.id}
            AND NOT EXISTS (
              SELECT 1 FROM relations c2
              WHERE c2.source_id = ${canonical.id} AND c2.target_id = r.target_id
                AND c2.relation_type = r.relation_type AND c2.valid_to IS NULL)
        `;
        await tx`DELETE FROM relations WHERE source_id = ${x.id}`;

        // (b) Re-apuntar target_id: la arista (source, x.id, type) pasa a (source, canonical.id, type).
        await tx`
          UPDATE relations r SET target_id = ${canonical.id}
          WHERE r.target_id = ${x.id}
            AND NOT EXISTS (
              SELECT 1 FROM relations c2
              WHERE c2.target_id = ${canonical.id} AND c2.source_id = r.source_id
                AND c2.relation_type = r.relation_type AND c2.valid_to IS NULL)
        `;
        await tx`DELETE FROM relations WHERE target_id = ${x.id}`;

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

import { getSql } from "@cortex/database";
import type { Row } from "../storage/map.js";
import { entityGroupKey, rankEntities } from "./domain/entity.js";

/**
 * The entity resolution loop (section 12.4): merges variants of the same entity
 * (e.g. "Acme"/"Acme Corp"/"acme.com") into a canonical one, re-pointing links
 * (context_entry_entities) and relations, and deduplicating. Database only, no LLM.
 *
 * Which variants group and which one is canonical are rules of the `entity` domain
 * (`entityGroupKey`, `rankEntities`); this only applies them inside one transaction per group.
 */

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

  const groups = new Map<string, Row[]>();
  for (const e of entities) {
    const key = entityGroupKey(e.type as string, e.name as string);
    if (!key) continue;
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
    const ranked = rankEntities(
      group.map((e) => ({ id: e.id as string, name: e.name as string, linkCount: linkCounts.get(e.id) ?? 0 })),
    );
    const canonical = ranked[0]!;
    const losers = ranked.slice(1);

    await sql.begin(async (tx) => {
      for (const x of losers) {
        // Re-point links without violating the (entry, entity) PK.
        await tx`
          UPDATE context_entry_entities cee SET entity_id = ${canonical.id}
          WHERE cee.entity_id = ${x.id}
            AND NOT EXISTS (
              SELECT 1 FROM context_entry_entities c2
              WHERE c2.context_entry_id = cee.context_entry_id AND c2.entity_id = ${canonical.id})
        `;
        await tx`DELETE FROM context_entry_entities WHERE entity_id = ${x.id}`;
        // Re-point relations without violating the partial UNIQUE `relations_active_unique`
        // (source_id, target_id, relation_type) WHERE valid_to IS NULL. Each UPDATE re-points
        // ONLY the loser's edges that, once the endpoint moves to `canonical`, would NOT
        // collide with an already-current edge; the DELETE afterwards removes the ones that
        // would have. source_id and target_id must be handled separately: a loser's edge can
        // collide through either endpoint depending on which one is re-pointed.

        // (a) Re-point source_id: edge (x.id, target, type) becomes (canonical.id, target, type).
        await tx`
          UPDATE relations r SET source_id = ${canonical.id}
          WHERE r.source_id = ${x.id}
            AND NOT EXISTS (
              SELECT 1 FROM relations c2
              WHERE c2.source_id = ${canonical.id} AND c2.target_id = r.target_id
                AND c2.relation_type = r.relation_type AND c2.valid_to IS NULL)
        `;
        await tx`DELETE FROM relations WHERE source_id = ${x.id}`;

        // (b) Re-point target_id: edge (source, x.id, type) becomes (source, canonical.id, type).
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

  await sql`DELETE FROM relations WHERE source_id = target_id`;
  await sql`
    DELETE FROM relations a USING relations b
    WHERE a.id > b.id AND a.source_id = b.source_id
      AND a.target_id = b.target_id AND a.relation_type = b.relation_type
  `;

  return { groups: groupsMerged, merged };
}

import { getSql } from "@cortex/database";
import type { Row } from "./map.js";
import { canonicalize } from "./text.js";

/**
 * The entity resolution loop (section 12.4): merges variants of the same entity
 * (e.g. "Acme"/"Acme Corp"/"acme.com") into a canonical one, re-pointing links
 * (context_entry_entities) and relations, and deduplicating. Database only, no LLM.
 *
 * It groups by TYPE + normalised name (no accents/punctuation, lowercase), excluding
 * `project` (a project is never merged or deleted). The type is part of the key on purpose:
 * two same-named entities of different types are different things (the `vendor` "Stripe" and
 * the `service` "Stripe" must not collapse into one).
 *
 * The canonical one is the entity with the most links; tie-breaks: the more descriptive
 * (longer) name and, still tied, the lower `id` -- so the result is DETERMINISTIC and does
 * not depend on the order Postgres happens to return rows in.
 */

// Normalisation on top of the shared canonical base (NFD + diacritics stripped + lowercase +
// trim + collapsed whitespace), also removing everything non-alphanumeric.
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

  // Group by type + normalised name.
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
    // Canonical: most links; tie-break by longer (more descriptive) name and, as a last
    // resort, by id -- without that last one the winner depends on the row order Postgres
    // returns, and the merge stops being reproducible.
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

  // Deduplicate relations and drop self-relations after the merge.
  await sql`DELETE FROM relations WHERE source_id = target_id`;
  await sql`
    DELETE FROM relations a USING relations b
    WHERE a.id > b.id AND a.source_id = b.source_id
      AND a.target_id = b.target_id AND a.relation_type = b.relation_type
  `;

  return { groups: groupsMerged, merged };
}

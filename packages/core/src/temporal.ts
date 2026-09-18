import { getSql } from "@cortex/database";
import type { Row } from "./map.js";

/**
 * Bi-temporal invalidation (the Zep/Graphiti pattern): it closes the validity window of facts
 * that stopped being current, rather than deleting them. That way the graph keeps its history
 * and supports point-in-time queries.
 *
 * Signals used (deterministic and real):
 *  - Plane's `Historico` state (migrated/legacy tasks) -> knowledge no longer current. The
 *    literal below stays in Spanish because it is Plane's own value, not our text.
 *  - `supersedes` relations entry->entry -> the superseded entry is closed.
 *
 * Idempotent: it only touches facts that are still current (valid_to IS NULL).
 */
export async function applyTemporalInvalidation(): Promise<{
  historical: number;
  superseded: number;
}> {
  const sql = getSql();

  const hist = (await sql`
    UPDATE context_entries
    SET valid_to = updated_at, validity = 'historical'
    WHERE metadata->>'state' = 'Histórico' AND valid_to IS NULL
    RETURNING id
  `) as unknown as Row[];

  const sup = (await sql`
    UPDATE context_entries b
    SET valid_to = GREATEST(a.created_at, b.valid_from),
        validity = 'superseded',
        superseded_by = a.id,
        status = CASE WHEN b.status = 'validated' THEN 'superseded' ELSE b.status END
    FROM relations r
    JOIN context_entries a ON a.id = r.source_id
    WHERE r.relation_type = 'supersedes'
      AND b.id = r.target_id
      AND a.id <> b.id
      AND b.valid_to IS NULL
    RETURNING b.id
  `) as unknown as Row[];

  return { historical: hist.length, superseded: sup.length };
}

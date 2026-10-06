import { getSql, type Sql } from "@cortex/database";
import { canonicalize } from "../../text.js";
import { rowToEntity, type Row } from "../../infrastructure/rows.js";
import type { EntityNameRow, EntityRepository, RelationInput } from "../domain/entity-repository.js";
import type { SharedEntity } from "../domain/across.js";
import type { Entity, EntityType } from "../domain/entity.js";

export class PgEntityRepository implements EntityRepository {
  constructor(private readonly sql: Sql = getSql()) {}

  async resolve(name: string, type: EntityType): Promise<Entity> {
    const canonical = canonicalize(name);
    const rows = (await this.sql`
      INSERT INTO entities (name, canonical_name, type)
      VALUES (${name}, ${canonical}, ${type})
      ON CONFLICT (type, canonical_name) DO UPDATE SET updated_at = now()
      RETURNING *
    `) as unknown as Row[];
    return rowToEntity(rows[0]!);
  }

  async linkMemo(memoId: string, entityId: string): Promise<void> {
    await this.sql`
      INSERT INTO memo_entities (memo_id, entity_id)
      VALUES (${memoId}, ${entityId})
      ON CONFLICT DO NOTHING
    `;
  }

  // Atomic and free of a TOCTOU race: it leans on the partial UNIQUE index
  // `relations_active_unique` (source_id, target_id, relation_type) WHERE valid_to IS NULL.
  // The ON CONFLICT must repeat that same partial predicate to match the index.
  async relate(args: RelationInput): Promise<void> {
    await this.sql`
      INSERT INTO relations (source_id, source_type, target_id, target_type, relation_type, confidence)
      VALUES (${args.sourceId}, ${args.sourceType}, ${args.targetId}, ${args.targetType},
              ${args.relationType}, ${args.confidence ?? "medium"})
      ON CONFLICT (source_id, target_id, relation_type) WHERE valid_to IS NULL DO NOTHING
    `;
  }

  async listResolvable(): Promise<EntityNameRow[]> {
    const rows = (await this.sql`SELECT id, name, type FROM entities WHERE type <> 'project'`) as unknown as Row[];
    return rows.map((r) => ({ id: r.id as string, name: r.name as string, type: r.type as string }));
  }

  async linkCounts(): Promise<Map<string, number>> {
    const rows = (await this.sql`SELECT entity_id, count(*)::int AS n FROM memo_entities GROUP BY entity_id`) as unknown as Row[];
    return new Map(rows.map((r) => [r.entity_id as string, Number(r.n)]));
  }

  // One transaction per group, so a merge either re-points everything or nothing.
  async mergeEntities(canonicalId: string, loserIds: string[]): Promise<void> {
    await this.sql.begin(async (tx) => {
      for (const loserId of loserIds) {
        // Re-point links without violating the (entry, entity) PK.
        await tx`
          UPDATE memo_entities me SET entity_id = ${canonicalId}
          WHERE me.entity_id = ${loserId}
            AND NOT EXISTS (
              SELECT 1 FROM memo_entities c2
              WHERE c2.memo_id = me.memo_id AND c2.entity_id = ${canonicalId})
        `;
        await tx`DELETE FROM memo_entities WHERE entity_id = ${loserId}`;
        // Re-point relations without violating the partial UNIQUE `relations_active_unique`
        // (source_id, target_id, relation_type) WHERE valid_to IS NULL. Each UPDATE re-points
        // ONLY the loser's edges that, once the endpoint moves to `canonical`, would NOT
        // collide with an already-current edge; the DELETE afterwards removes the ones that
        // would have. source_id and target_id must be handled separately: a loser's edge can
        // collide through either endpoint depending on which one is re-pointed.

        // (a) Re-point source_id: edge (loserId, target, type) becomes (canonicalId, target, type).
        await tx`
          UPDATE relations r SET source_id = ${canonicalId}
          WHERE r.source_id = ${loserId}
            AND NOT EXISTS (
              SELECT 1 FROM relations c2
              WHERE c2.source_id = ${canonicalId} AND c2.target_id = r.target_id
                AND c2.relation_type = r.relation_type AND c2.valid_to IS NULL)
        `;
        await tx`DELETE FROM relations WHERE source_id = ${loserId}`;

        // (b) Re-point target_id: edge (source, loserId, type) becomes (source, canonicalId, type).
        await tx`
          UPDATE relations r SET target_id = ${canonicalId}
          WHERE r.target_id = ${loserId}
            AND NOT EXISTS (
              SELECT 1 FROM relations c2
              WHERE c2.target_id = ${canonicalId} AND c2.source_id = r.source_id
                AND c2.relation_type = r.relation_type AND c2.valid_to IS NULL)
        `;
        await tx`DELETE FROM relations WHERE target_id = ${loserId}`;

        await tx`DELETE FROM entities WHERE id = ${loserId}`;
      }
    });
  }

  async normalizeRelations(): Promise<void> {
    await this.sql`DELETE FROM relations WHERE source_id = target_id`;
    await this.sql`
      DELETE FROM relations a USING relations b
      WHERE a.id > b.id AND a.source_id = b.source_id
        AND a.target_id = b.target_id AND a.relation_type = b.relation_type
    `;
  }

  /**
   * Entities linked from current entries of TWO OR MORE of these projects.
   *
   * Entities are global (one row per type and canonical name across the whole installation), so
   * the cross-over has existed in the data for a long time: what was missing was somewhere to
   * look at it.
   *
   * This is "what the memory has linked from several repos", not an architecture inventory: it
   * comes from what the agents wrote, noise included. That is why it is ordered by how many it
   * appears in and then cut: a long list does not get read, and the first rows are the ones that
   * say something.
   */
  async sharedStack(projectIds: string[], types: EntityType[], limit: number): Promise<SharedEntity[]> {
    const rows = (await this.sql`
      SELECT e.name, e.type,
             count(DISTINCT m.id)::int AS entries,
             json_agg(DISTINCT jsonb_build_object('name', p.name, 'slug', p.slug)) AS projects
      FROM entities e
      JOIN memo_entities me ON me.entity_id = e.id
      JOIN memos m ON m.id = me.memo_id
        AND m.valid_to IS NULL AND m.status NOT IN ('rejected', 'obsolete')
        AND m.project_id = ANY(${projectIds})
      JOIN entities p ON p.id = m.project_id
      WHERE e.type = ANY(${types})
      GROUP BY e.id, e.name, e.type
      HAVING count(DISTINCT m.project_id) >= 2
      ORDER BY count(DISTINCT m.project_id) DESC, count(DISTINCT m.id) DESC, e.name
      LIMIT ${limit}
    `) as unknown as Row[];
    return rows.map((r) => ({
      name: r.name as string,
      type: r.type as EntityType,
      entries: Number(r.entries),
      projects: (r.projects as { name: string; slug: string | null }[]).sort((x, y) => x.name.localeCompare(y.name)),
    }));
  }
}

import type { Sql } from "@cortex/database";
import type { Entity, EntityType, RelationType, ConfidenceLevel } from "@cortex/shared";
import { canonicalize } from "./text.js";
import { rowToEntity, type Row } from "./map.js";

/**
 * Finds or creates an entity by (type, canonical name). The basis of entity resolution
 * (section 12.4): different spellings of the same name converge on the canonical one.
 */
export async function resolveEntity(
  sql: Sql,
  name: string,
  type: EntityType,
): Promise<Entity> {
  // A project is not "resolved": it is created with a slug and an owner in `createProject`.
  // The ghosts of #135 were born here (26 in one real installation), and the database no
  // longer accepts them.
  if (type === "project") throw new Error(`resolveEntity: "${name}" is a project; use createProject.`);
  const canonical = canonicalize(name);
  const rows = (await sql`
    INSERT INTO entities (name, canonical_name, type)
    VALUES (${name}, ${canonical}, ${type})
    ON CONFLICT (type, canonical_name) DO UPDATE SET updated_at = now()
    RETURNING *
  `) as unknown as Row[];
  return rowToEntity(rows[0]!);
}

/** Links a context entry with an entity it mentions. */
export async function linkEntryToEntity(
  sql: Sql,
  contextEntryId: string,
  entityId: string,
): Promise<void> {
  await sql`
    INSERT INTO context_entry_entities (context_entry_id, entity_id)
    VALUES (${contextEntryId}, ${entityId})
    ON CONFLICT DO NOTHING
  `;
}

/**
 * Creates a relation between two entities/entries unless an equivalent current one exists.
 * Atomic and free of a TOCTOU race: it leans on the partial UNIQUE index
 * `relations_active_unique` (source_id, target_id, relation_type) WHERE valid_to IS NULL.
 * The ON CONFLICT must repeat that same partial predicate to match the index.
 */
export async function relate(
  sql: Sql,
  args: {
    sourceId: string;
    sourceType: string;
    targetId: string;
    targetType: string;
    relationType: RelationType;
    confidence?: ConfidenceLevel;
  },
): Promise<void> {
  await sql`
    INSERT INTO relations (source_id, source_type, target_id, target_type, relation_type, confidence)
    VALUES (${args.sourceId}, ${args.sourceType}, ${args.targetId}, ${args.targetType},
            ${args.relationType}, ${args.confidence ?? "medium"})
    ON CONFLICT (source_id, target_id, relation_type) WHERE valid_to IS NULL DO NOTHING
  `;
}

import { getSql, type Sql } from "@cortex/database";
import type { Entity, EntityType } from "@cortex/shared";
import { canonicalize } from "../../text.js";
import { rowToEntity, type Row } from "../../storage/map.js";
import type { EntityRepository, RelationInput } from "../domain/entity-repository.js";

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

  async linkEntry(contextEntryId: string, entityId: string): Promise<void> {
    await this.sql`
      INSERT INTO context_entry_entities (context_entry_id, entity_id)
      VALUES (${contextEntryId}, ${entityId})
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
}

import type { Sql } from "@cortex/database";
import type { Entity, EntityType, RelationType, ConfidenceLevel } from "@cortex/shared";
import { canonicalize } from "./text.js";
import { rowToEntity, type Row } from "./map.js";

/**
 * Busca o crea una entidad por (tipo, nombre canónico). Base de la resolución de
 * entidades (§12.4): distintas grafías del mismo nombre convergen al canónico.
 */
export async function resolveEntity(
  sql: Sql,
  name: string,
  type: EntityType,
): Promise<Entity> {
  const canonical = canonicalize(name);
  const rows = (await sql`
    INSERT INTO entities (name, canonical_name, type)
    VALUES (${name}, ${canonical}, ${type})
    ON CONFLICT (type, canonical_name) DO UPDATE SET updated_at = now()
    RETURNING *
  `) as unknown as Row[];
  return rowToEntity(rows[0]!);
}

/** Enlaza una entrada de contexto con una entidad que menciona. */
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

/** Crea una relación entre dos entidades/entradas si no existe una equivalente. */
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
  const exists = (await sql`
    SELECT 1 FROM relations
    WHERE source_id = ${args.sourceId} AND target_id = ${args.targetId}
      AND relation_type = ${args.relationType}
    LIMIT 1
  `) as unknown as Row[];
  if (exists.length > 0) return;
  await sql`
    INSERT INTO relations (source_id, source_type, target_id, target_type, relation_type, confidence)
    VALUES (${args.sourceId}, ${args.sourceType}, ${args.targetId}, ${args.targetType},
            ${args.relationType}, ${args.confidence ?? "medium"})
  `;
}

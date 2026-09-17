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
  // Un proyecto no se «resuelve»: se crea con slug y dueño en `createProject`. Por aquí
  // nacían los fantasmas de #135 (26 en una instalación real), y la base ya no los admite.
  if (type === "project") throw new Error(`resolveEntity: "${name}" es un proyecto; usa createProject.`);
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

/**
 * Crea una relación entre dos entidades/entradas si no existe una equivalente
 * vigente. Atómico y sin race TOCTOU: se apoya en el índice UNIQUE parcial
 * `relations_active_unique` (source_id, target_id, relation_type) WHERE valid_to IS NULL.
 * El ON CONFLICT debe replicar ese mismo predicado parcial para casar con el índice.
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

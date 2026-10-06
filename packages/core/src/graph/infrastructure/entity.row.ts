import type { Row } from "@cortex/database";
import type { Entity } from "../domain/entity.js";

export function rowToEntity(row: Row): Entity {
  return {
    id: row.id,
    name: row.name,
    canonicalName: row.canonical_name,
    type: row.type,
    metadata: row.metadata ?? {},
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

import type { ContextEntry, Entity } from "@cortex/shared";

/** Fila cruda devuelta por postgres.js (columnas en snake_case). */
export type Row = Record<string, any>;

export function rowToContextEntry(row: Row): ContextEntry {
  return {
    id: row.id,
    projectId: row.project_id ?? null,
    clientId: row.client_id ?? null,
    title: row.title,
    content: row.content,
    summary: row.summary ?? null,
    type: row.type,
    status: row.status,
    confidence: row.confidence,
    validity: row.validity,
    sourceType: row.source_type,
    sourceReference: row.source_reference ?? null,
    createdBy: row.created_by ?? null,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    supersededBy: row.superseded_by ?? null,
    metadata: row.metadata ?? {},
  };
}

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

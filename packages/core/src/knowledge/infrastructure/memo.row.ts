import type { Row } from "@cortex/database";
import type { Memo } from "../domain/memo.js";

export function rowToMemo(row: Row): Memo {
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
    validFrom: row.valid_from,
    validTo: row.valid_to ?? null,
    observedAt: row.observed_at,
  };
}

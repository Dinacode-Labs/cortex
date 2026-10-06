import type { Row } from "@cortex/database";
import type { Source } from "../domain/source.js";

export function rowToSource(row: Row): Source {
  return {
    id: row.id,
    sourceType: row.source_type,
    externalId: row.external_id ?? null,
    url: row.url ?? null,
    rawContent: row.raw_content ?? null,
    metadata: row.metadata ?? {},
    createdAt: row.created_at,
  };
}

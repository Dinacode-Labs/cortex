import { getSql, type Sql } from "@cortex/database";
import type { ContextEntry } from "@cortex/shared";
import { rowToContextEntry, type Row } from "../../storage/map.js";
import type { ContextEntryRepository, NewContextEntry, NewSource } from "../domain/context-entry-repository.js";

type JsonValue = Parameters<Sql["json"]>[0];

export class PgContextEntryRepository implements ContextEntryRepository {
  constructor(private readonly sql: Sql = getSql()) {}

  async createSource(source: NewSource): Promise<string> {
    const rows = (await this.sql`
      INSERT INTO sources (source_type, raw_content, metadata)
      VALUES (${source.sourceType}, ${source.rawContent}, ${this.sql.json(source.metadata as JsonValue)})
      RETURNING id
    `) as unknown as Row[];
    return rows[0]!.id as string;
  }

  async createEntry(entry: NewContextEntry): Promise<ContextEntry> {
    const rows = (await this.sql`
      INSERT INTO context_entries
        (project_id, source_id, title, content, summary, type, confidence,
         source_type, source_reference, created_by, metadata)
      VALUES (${entry.projectId}, ${entry.sourceId}, ${entry.title}, ${entry.content}, ${entry.summary},
              ${entry.type}, ${entry.confidence}, ${entry.sourceType}, ${entry.sourceReference},
              ${entry.createdBy}, ${this.sql.json(entry.metadata as JsonValue)})
      RETURNING *
    `) as unknown as Row[];
    return rowToContextEntry(rows[0]!);
  }

  // Bi-temporal invalidation (the Zep/Graphiti pattern): close the validity window rather than
  // delete, so the graph keeps its history and supports point-in-time queries (ADR-0012).
  // Idempotent: only facts that are still current (valid_to IS NULL) are touched.
  async closeHistoricalStates(): Promise<number> {
    const rows = (await this.sql`
      UPDATE context_entries
      SET valid_to = updated_at, validity = 'historical'
      WHERE metadata->>'state' = 'Histórico' AND valid_to IS NULL
      RETURNING id
    `) as unknown as Row[];
    return rows.length;
  }

  async applySupersessions(): Promise<number> {
    // `validity` says whether the fact still holds (current/historical/unknown); it has no
    // 'superseded' value, and writing one violated the table's CHECK and aborted maintenance
    // whenever a `supersedes` relation existed. Superseded-ness is `status` and `superseded_by`,
    // exactly as `invalidateEntry` does it.
    const rows = (await this.sql`
      UPDATE context_entries b
      SET valid_to = GREATEST(a.created_at, b.valid_from),
          validity = 'historical',
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
    return rows.length;
  }

  // Auto-curation, over auto-captured knowledge only (`source_type = 'agent_session'`, low
  // confidence): promote what was corroborated, decay what was never confirmed (ADR-0067).
  async promoteCorroborated(): Promise<number> {
    const rows = (await this.sql`
      UPDATE context_entries SET confidence = 'medium'
      WHERE confidence = 'low' AND source_type = 'agent_session'
        AND status = 'pending_validation' AND valid_to IS NULL
        AND cortex_corroborations(metadata) >= 1
      RETURNING id
    `) as unknown as Row[];
    return rows.length;
  }

  async decayUncorroborated(decayDays: number): Promise<number> {
    const rows = (await this.sql`
      UPDATE context_entries SET status = 'obsolete'
      WHERE confidence = 'low' AND source_type = 'agent_session'
        AND status = 'pending_validation' AND valid_to IS NULL
        AND cortex_corroborations(metadata) = 0
        AND created_at < now() - make_interval(days => ${decayDays})
      RETURNING id
    `) as unknown as Row[];
    return rows.length;
  }

  // One statement rather than read-modify-write, because two sessions closing at the same time
  // would otherwise read the same value and store the same increment.
  async recordCorroboration(entryId: string): Promise<void> {
    await this.sql`
      UPDATE context_entries
         SET metadata = jsonb_set(metadata, '{corroborations}',
                                  to_jsonb(cortex_corroborations(metadata) + 1))
       WHERE id = ${entryId}
    `;
  }

  // Bi-temporal DELETE (section 5.5: invalidating is not deleting). `validity` stays within
  // current/historical/unknown: superseded-ness is `status` and `superseded_by`.
  async invalidate(entryId: string, supersededById: string): Promise<void> {
    await this.sql`
      UPDATE context_entries
      SET valid_to = now(), validity = 'historical', status = 'superseded', superseded_by = ${supersededById}
      WHERE id = ${entryId} AND valid_to IS NULL
    `;
  }

  async updateEntryFields(entryId: string, fields: { title?: string; content?: string }): Promise<boolean> {
    const { title, content } = fields;
    if (title === undefined && content === undefined) return false;
    const rows = (await this.sql`
      UPDATE context_entries
         SET title = COALESCE(${title ?? null}, title),
             content = COALESCE(${content ?? null}, content),
             updated_at = now()
       WHERE id = ${entryId}
       RETURNING id
    `) as unknown as { id: string }[];
    return rows.length > 0;
  }

  async updateEntryContent(entryId: string, content: string): Promise<void> {
    await this.sql`UPDATE context_entries SET content = ${content}, updated_at = now() WHERE id = ${entryId}`;
  }

  async findNearDuplicatePairs(
    projectId: string,
    maxDistance: number,
    skipFormats: string[],
  ): Promise<{ keep: string; drop: string }[]> {
    return (await this.sql`
      SELECT a.id AS keep, b.id AS drop
      FROM embeddings ea
      JOIN context_entries a ON a.id = ea.context_entry_id
      JOIN embeddings eb ON eb.embedding_model = ea.embedding_model
        AND eb.embedding_version = ea.embedding_version AND eb.chunk_index = ea.chunk_index
      JOIN context_entries b ON b.id = eb.context_entry_id
      WHERE a.project_id = ${projectId} AND b.project_id = ${projectId}
        AND a.source_type = b.source_type
        AND a.valid_to IS NULL AND b.valid_to IS NULL
        AND a.status NOT IN ('rejected', 'obsolete', 'superseded')
        AND b.status NOT IN ('rejected', 'obsolete', 'superseded')
        AND coalesce(a.metadata->>'format', '') <> ALL(${skipFormats})
        AND coalesce(b.metadata->>'format', '') <> ALL(${skipFormats})
        AND a.created_at < b.created_at
        AND (ea.vector <=> eb.vector) < ${maxDistance}
      ORDER BY b.created_at ASC
    `) as unknown as { keep: string; drop: string }[];
  }
}

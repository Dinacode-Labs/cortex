import { getSql, type Sql } from "@cortex/database";
import { rowToMemo, type Row } from "../../infrastructure/rows.js";
import type {
  ContradictingSide,
  MemoRepository,
  NewMemo,
  NewSource,
  PurgeTarget,
  ReclassifiableMemo,
  SummarizableMemo,
} from "../domain/memo-repository.js";
import type { Memo, MemoStatus, MemoType } from "../domain/memo.js";

type JsonValue = Parameters<Sql["json"]>[0];

export class PgMemoRepository implements MemoRepository {
  constructor(private readonly sql: Sql = getSql()) {}

  async createSource(source: NewSource): Promise<string> {
    const rows = (await this.sql`
      INSERT INTO sources (source_type, raw_content, metadata)
      VALUES (${source.sourceType}, ${source.rawContent}, ${this.sql.json(source.metadata as JsonValue)})
      RETURNING id
    `) as unknown as Row[];
    return rows[0]!.id as string;
  }

  async createMemo(memo: NewMemo): Promise<Memo> {
    const rows = (await this.sql`
      INSERT INTO memos
        (project_id, source_id, title, content, summary, type, confidence,
         source_type, source_reference, created_by, metadata, language)
      VALUES (${memo.projectId}, ${memo.sourceId}, ${memo.title}, ${memo.content}, ${memo.summary},
              ${memo.type}, ${memo.confidence}, ${memo.sourceType}, ${memo.sourceReference},
              ${memo.createdBy}, ${this.sql.json(memo.metadata as JsonValue)}, ${memo.language})
      RETURNING *
    `) as unknown as Row[];
    return rowToMemo(rows[0]!);
  }

  // Bi-temporal invalidation (the Zep/Graphiti pattern): close the validity window rather than
  // delete, so the graph keeps its history and supports point-in-time queries (ADR-0012).
  // Idempotent: only facts that are still current (valid_to IS NULL) are touched.
  async closeHistoricalStates(): Promise<number> {
    const rows = (await this.sql`
      UPDATE memos
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
      UPDATE memos b
      SET valid_to = GREATEST(a.created_at, b.valid_from),
          validity = 'historical',
          superseded_by = a.id,
          status = CASE WHEN b.status = 'validated' THEN 'superseded' ELSE b.status END
      FROM relations r
      JOIN memos a ON a.id = r.source_id
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
      UPDATE memos SET confidence = 'medium'
      WHERE confidence = 'low' AND source_type = 'agent_session'
        AND status = 'pending_validation' AND valid_to IS NULL
        AND cortex_corroborations(metadata) >= 1
      RETURNING id
    `) as unknown as Row[];
    return rows.length;
  }

  async decayUncorroborated(decayDays: number): Promise<number> {
    const rows = (await this.sql`
      UPDATE memos SET status = 'obsolete'
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
  async recordCorroboration(memoId: string): Promise<void> {
    await this.sql`
      UPDATE memos
         SET metadata = jsonb_set(metadata, '{corroborations}',
                                  to_jsonb(cortex_corroborations(metadata) + 1))
       WHERE id = ${memoId}
    `;
  }

  // Bi-temporal DELETE (section 5.5: invalidating is not deleting). `validity` stays within
  // current/historical/unknown: superseded-ness is `status` and `superseded_by`.
  async invalidate(memoId: string, supersededById: string): Promise<void> {
    await this.sql`
      UPDATE memos
      SET valid_to = now(), validity = 'historical', status = 'superseded', superseded_by = ${supersededById}
      WHERE id = ${memoId} AND valid_to IS NULL
    `;
  }

  async updateMemoFields(memoId: string, fields: { title?: string; content?: string }): Promise<boolean> {
    const { title, content } = fields;
    if (title === undefined && content === undefined) return false;
    const rows = (await this.sql`
      UPDATE memos
         SET title = COALESCE(${title ?? null}, title),
             content = COALESCE(${content ?? null}, content),
             updated_at = now()
       WHERE id = ${memoId}
       RETURNING id
    `) as unknown as { id: string }[];
    return rows.length > 0;
  }

  async updateMemoContent(memoId: string, content: string): Promise<void> {
    await this.sql`UPDATE memos SET content = ${content}, updated_at = now() WHERE id = ${memoId}`;
  }

  async findNearDuplicatePairs(
    projectId: string,
    maxDistance: number,
    skipFormats: string[],
  ): Promise<{ keep: string; drop: string }[]> {
    return (await this.sql`
      SELECT a.id AS keep, b.id AS drop
      FROM embeddings ea
      JOIN memos a ON a.id = ea.memo_id
      JOIN embeddings eb ON eb.embedding_model = ea.embedding_model
        AND eb.embedding_version = ea.embedding_version AND eb.chunk_index = ea.chunk_index
      JOIN memos b ON b.id = eb.memo_id
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

  async findContradictionCandidates(entityIds: string[], excludeId: string): Promise<Memo[]> {
    const rows = (await this.sql`
      SELECT DISTINCT m.*
      FROM memos m
      JOIN memo_entities me ON me.memo_id = m.id
      WHERE me.entity_id IN ${this.sql(entityIds)}
        AND m.id <> ${excludeId}
        AND m.status NOT IN ('rejected', 'obsolete')
    `) as unknown as Row[];
    return rows.map(rowToMemo);
  }

  async findIdBySourceReference(projectId: string, sourceReference: string): Promise<string | null> {
    const rows = (await this.sql`
      SELECT id FROM memos WHERE project_id = ${projectId} AND source_reference = ${sourceReference} LIMIT 1
    `) as unknown as Row[];
    return rows[0] ? (rows[0].id as string) : null;
  }

  async findReclassifiable(projectId: string): Promise<ReclassifiableMemo[]> {
    const rows = (await this.sql`
      SELECT id, title, content, summary, type, metadata
      FROM memos
      WHERE project_id = ${projectId} AND valid_to IS NULL
        AND COALESCE(metadata->>'enrichedBy', 'heuristic') NOT IN ('llm', 'distiller')
    `) as unknown as Row[];
    return rows.map((r) => ({
      id: r.id as string,
      title: r.title as string,
      content: r.content as string,
      summary: (r.summary as string | null) ?? null,
      type: r.type as MemoType,
      metadata: (r.metadata as Record<string, unknown>) ?? {},
    }));
  }

  async findSummariesToRebuild(projectId: string | null): Promise<SummarizableMemo[]> {
    const rows = (await this.sql`
      SELECT id, project_id, title, content, summary
      FROM memos
      WHERE valid_to IS NULL
        ${projectId ? this.sql`AND project_id = ${projectId}` : this.sql``}
    `) as unknown as Row[];
    return rows.map((r) => ({
      id: r.id as string,
      projectId: (r.project_id as string | null) ?? null,
      title: r.title as string,
      content: r.content as string,
      summary: (r.summary as string | null) ?? null,
    }));
  }

  async retype(id: string, change: { type: MemoType; summary: string | null; metadata: Record<string, unknown> }): Promise<void> {
    await this.sql`
      UPDATE memos
      SET type = ${change.type}, summary = ${change.summary}, metadata = ${this.sql.json(change.metadata as JsonValue)}
      WHERE id = ${id}
    `;
  }

  async updateSummary(id: string, summary: string): Promise<void> {
    await this.sql`UPDATE memos SET summary = ${summary} WHERE id = ${id}`;
  }

  async findPurgeTargets(ids: string[]): Promise<PurgeTarget[]> {
    const rows = (await this.sql`
      SELECT m.id, m.project_id, p.slug, p.name
        FROM memos m
        LEFT JOIN entities p ON p.id = m.project_id
       WHERE m.id = ANY(${ids}::uuid[])
    `) as unknown as Row[];
    return rows.map((r) => ({
      id: r.id as string,
      projectId: (r.project_id as string | null) ?? null,
      projectSlug: (r.slug as string | null) ?? null,
      projectName: (r.name as string | null) ?? null,
    }));
  }

  async purge(ids: string[], purgedBy: string): Promise<string[]> {
    return this.sql.begin(async (tx) => {
      // FOR UPDATE holds the entries while the whole cleanup runs, so nobody edits one in the
      // middle of it.
      const entries = (await tx`
        SELECT m.id, m.source_id, m.project_id, m.type, m.source_type, m.created_at
          FROM memos m
         WHERE m.id = ANY(${ids}::uuid[])
           FOR UPDATE OF m
      `) as unknown as Row[];
      const found = entries.map((e) => e.id as string);
      if (found.length === 0) return [];
      const sourceIds = entries.map((e) => e.source_id as string | null).filter((s): s is string => !!s);
      const linkedEntities = (await tx`
        SELECT DISTINCT entity_id FROM memo_entities WHERE memo_id = ANY(${found}::uuid[])
      `) as unknown as Row[];

      // An entry these had superseded becomes current again and waits for review.
      await tx`
        UPDATE memos
           SET superseded_by = NULL, valid_to = NULL, validity = 'current',
               status = CASE WHEN status IN ('rejected', 'obsolete') THEN status ELSE 'pending_validation' END
         WHERE superseded_by = ANY(${found}::uuid[]) AND NOT (id = ANY(${found}::uuid[]))
      `;
      await tx`
        DELETE FROM relations WHERE source_id = ANY(${found}::uuid[]) OR target_id = ANY(${found}::uuid[])
      `;
      for (const e of entries) {
        await tx`
          INSERT INTO entry_purges (entry_id, project_id, entry_type, entry_source_type, entry_created_at, purged_by)
          VALUES (${e.id as string}, ${(e.project_id as string | null) ?? null}, ${e.type as string},
                  ${e.source_type as string}, ${e.created_at as Date}, ${purgedBy.toLowerCase()})
        `;
      }
      await tx`DELETE FROM memos WHERE id = ANY(${found}::uuid[])`;

      if (sourceIds.length) {
        await tx`
          DELETE FROM sources s
           WHERE s.id = ANY(${sourceIds}::uuid[])
             AND NOT EXISTS (SELECT 1 FROM memos m WHERE m.source_id = s.id)
        `;
      }
      const entityIds = linkedEntities.map((r) => r.entity_id as string);
      if (entityIds.length) {
        await tx`
          DELETE FROM entities en
           WHERE en.id = ANY(${entityIds}::uuid[])
             AND en.type NOT IN ('project', 'client')
             AND NOT EXISTS (SELECT 1 FROM memo_entities me WHERE me.entity_id = en.id)
             AND NOT EXISTS (SELECT 1 FROM relations r WHERE r.source_id = en.id OR r.target_id = en.id)
             AND NOT EXISTS (SELECT 1 FROM memos m WHERE m.project_id = en.id OR m.client_id = en.id)
             AND NOT EXISTS (SELECT 1 FROM entities child WHERE child.parent_id = en.id)
        `;
      }
      return found;
    });
  }

  async contradictingPairs(projectIds: string[], limit: number): Promise<{ a: ContradictingSide; b: ContradictingSide }[]> {
    const rows = (await this.sql`
      SELECT ca.id AS a_id, ca.title AS a_title, ca.created_at AS a_at, ca.project_id AS a_project,
             cb.id AS b_id, cb.title AS b_title, cb.created_at AS b_at, cb.project_id AS b_project
      FROM relations r
      JOIN memos ca ON ca.id = r.source_id AND ca.valid_to IS NULL
      JOIN memos cb ON cb.id = r.target_id AND cb.valid_to IS NULL
      WHERE r.relation_type = 'contradicts'
        AND ca.project_id = ANY(${projectIds}) AND cb.project_id = ANY(${projectIds})
      LIMIT ${limit}
    `) as unknown as Row[];
    return rows.map((r) => ({
      a: { id: r.a_id as string, title: r.a_title as string, createdAt: new Date(r.a_at as string), projectId: (r.a_project as string) ?? null },
      b: { id: r.b_id as string, title: r.b_title as string, createdAt: new Date(r.b_at as string), projectId: (r.b_project as string) ?? null },
    }));
  }

  async setStatus(id: string, status: MemoStatus): Promise<Memo | null> {
    const rows = (await this.sql`UPDATE memos SET status = ${status} WHERE id = ${id} RETURNING *`) as unknown as Row[];
    return rows[0] ? rowToMemo(rows[0]) : null;
  }
}

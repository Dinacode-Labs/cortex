import type { Row, Sql } from "@cortex/database";
import type { DUPLICATE_DISTANCE, HealthReader, LintReport } from "../domain/health.js";

const count = (rows: Row[]): number => Number(rows[0]?.n ?? 0);

export class PgHealthReader implements HealthReader {
  constructor(private readonly sql: Sql) {}

  async currentCount(projectId: string): Promise<number> {
    const rows = await this.sql`SELECT count(*)::int n FROM memos WHERE project_id=${projectId} AND valid_to IS NULL`;
    return count(rows as unknown as Row[]);
  }

  async contradictions(projectId: string, limit: number): Promise<LintReport["contradictions"]> {
    const pid = projectId;
    const rows = (await this.sql`
      SELECT COALESCE(es.name, ces.title, '?') AS a, COALESCE(et.name, cet.title, '?') AS b,
             ces.id AS a_id, cet.id AS b_id
      FROM relations r
      LEFT JOIN entities es ON es.id=r.source_id
      LEFT JOIN memos ces ON ces.id=r.source_id
      LEFT JOIN entities et ON et.id=r.target_id
      LEFT JOIN memos cet ON cet.id=r.target_id
      WHERE r.relation_type='contradicts'
        AND (ces.project_id=${pid} OR cet.project_id=${pid}
             OR es.id IN (SELECT me.entity_id FROM memo_entities me JOIN memos c ON c.id=me.memo_id WHERE c.project_id=${pid})
             OR et.id IN (SELECT me.entity_id FROM memo_entities me JOIN memos c ON c.id=me.memo_id WHERE c.project_id=${pid}))
      LIMIT ${limit}
    `) as unknown as Row[];
    return rows.map((r) => ({
      a: r.a as string,
      b: r.b as string,
      aId: (r.a_id as string | null) ?? null,
      bId: (r.b_id as string | null) ?? null,
    }));
  }

  async likelyDuplicates(
    projectId: string,
    distance: typeof DUPLICATE_DISTANCE,
    limit: number,
  ): Promise<LintReport["duplicates"]> {
    // `doc_key` is which document an entry came out of. An ingested file is split into
    // overlapping chunks (`chunkDocument`, ADR-0023) that share 400 characters by construction:
    // consecutive parts of one source are neighbours, not duplicates, and they used to fill the
    // report. A missing or empty reference groups with nothing.
    const rows = (await this.sql`
      WITH current_entries AS (
        SELECT id, title, type, NULLIF(COALESCE(metadata->>'file', source_reference), '') AS doc_key
        FROM memos
        WHERE project_id=${projectId} AND valid_to IS NULL
      )
      SELECT ca.title AS a, cb.title AS b, ca.id AS a_id, cb.id AS b_id,
             (1 - (a.vector <=> b.vector)) AS score
      FROM embeddings a
      JOIN embeddings b ON a.memo_id < b.memo_id
        AND a.embedding_model = b.embedding_model
      JOIN current_entries ca ON ca.id=a.memo_id
      JOIN current_entries cb ON cb.id=b.memo_id
      WHERE (a.vector <=> b.vector)
            < CASE WHEN ca.type = cb.type THEN ${distance.sameType}::float8 ELSE ${distance.otherType}::float8 END
        AND (ca.doc_key IS NULL OR ca.doc_key IS DISTINCT FROM cb.doc_key)
      ORDER BY score DESC
      LIMIT ${limit}
    `) as unknown as Row[];
    return rows.map((r) => ({
      a: r.a as string,
      b: r.b as string,
      score: Number(r.score),
      aId: r.a_id as string,
      bId: r.b_id as string,
    }));
  }

  async orphanEntities(projectId: string, limit: number): Promise<LintReport["orphanEntities"]> {
    const rows = (await this.sql`
      SELECT en.name, en.type
      FROM entities en
      JOIN memo_entities me ON me.entity_id=en.id
      JOIN memos m ON m.id=me.memo_id AND m.project_id=${projectId} AND m.valid_to IS NULL
      WHERE en.type<>'project'
        AND NOT EXISTS (SELECT 1 FROM relations r WHERE r.source_id=en.id OR r.target_id=en.id)
      GROUP BY en.id, en.name, en.type
      HAVING count(DISTINCT me.memo_id)=1
      LIMIT ${limit}
    `) as unknown as Row[];
    return rows.map((r) => ({ name: r.name as string, type: r.type as string }));
  }

  async neverReviewedCount(projectId: string): Promise<number> {
    const rows = await this.sql`
      SELECT count(*)::int n FROM memos WHERE project_id=${projectId} AND status='pending_validation' AND valid_to IS NULL`;
    return count(rows as unknown as Row[]);
  }

  async lowConfidenceCount(projectId: string): Promise<number> {
    const rows = await this.sql`
      SELECT count(*)::int n FROM memos WHERE project_id=${projectId} AND confidence='low' AND valid_to IS NULL`;
    return count(rows as unknown as Row[]);
  }

  async historicalCount(projectId: string): Promise<number> {
    // 'Histórico' is Plane's own value for a closed task, not our Spanish: it is matched as Plane writes it.
    const rows = await this.sql`
      SELECT count(*)::int n FROM memos
      WHERE project_id=${projectId} AND (validity='historical' OR metadata->>'state'='Histórico')`;
    return count(rows as unknown as Row[]);
  }

  async incidentGaps(projectId: string, minIncidents: number, limit: number): Promise<LintReport["gaps"]> {
    const rows = (await this.sql`
      SELECT en.name, en.type, count(*) FILTER (WHERE m.type='incident') AS incidents
      FROM entities en
      JOIN memo_entities me ON me.entity_id=en.id
      JOIN memos m ON m.id=me.memo_id AND m.project_id=${projectId} AND m.valid_to IS NULL
      WHERE en.type IN ('module','service')
      GROUP BY en.id, en.name, en.type
      HAVING count(*) FILTER (WHERE m.type='incident') >= ${minIncidents}
         AND count(*) FILTER (WHERE m.type='decision') = 0
      ORDER BY incidents DESC
      LIMIT ${limit}
    `) as unknown as Row[];
    return rows.map((r) => ({ area: r.name as string, type: r.type as string, incidents: Number(r.incidents) }));
  }
}

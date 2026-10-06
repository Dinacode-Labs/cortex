import type { Sql } from "@cortex/database";
import type { Entity } from "@cortex/shared";
import { rowToEntity, rowToMemo, rowToSource, type Row } from "../../infrastructure/rows.js";
import type { EntryDetail, EntrySort, MemoListFilter, MemoReader, ProjectGraphData } from "../domain/memo-reader.js";
import type { Memo, MemoType } from "../domain/memo.js";

export class PgMemoReader implements MemoReader {
  constructor(private readonly sql: Sql) {}

  async projectsWithCounts(): Promise<{ entity: Entity; entryCount: number }[]> {
    const rows = (await this.sql`
      SELECT e.*, count(m.id)::int AS entry_count
      FROM entities e
      LEFT JOIN memos m ON m.project_id = e.id
      WHERE e.type = 'project'
      GROUP BY e.id
      ORDER BY e.name
    `) as unknown as Row[];
    return rows.map((r) => ({ entity: rowToEntity(r), entryCount: Number(r.entry_count) }));
  }

  async list(filter: MemoListFilter): Promise<Memo[]> {
    const sql = this.sql;
    let where = sql`WHERE true`;
    if (filter.projectId) {
      where = sql`${where} AND m.project_id = ${filter.projectId}`;
    } else if (filter.accessibleProjectIds) {
      // An entry with no project is visible to anyone with a session: there is no project to
      // restrict it (the same rule as `checkEntryAccess`, which returns `ok` with `project: null`).
      where = sql`${where} AND (m.project_id IS NULL OR m.project_id = ANY(${filter.accessibleProjectIds}))`;
    }
    if (filter.type) where = sql`${where} AND m.type = ${filter.type}`;
    if (filter.status) where = sql`${where} AND m.status = ${filter.status}`;
    const rows = (await sql`
      SELECT m.* FROM memos m
      ${where}
      ${this.order(filter.sort)}
      LIMIT ${filter.limit}
    `) as unknown as Row[];
    return rows.map(rowToMemo);
  }

  private order(sort: EntrySort) {
    const column = sort.by === "updated" ? this.sql`m.updated_at` : this.sql`m.created_at`;
    return sort.dir === "asc"
      ? this.sql`ORDER BY ${column} ASC, m.id ASC`
      : this.sql`ORDER BY ${column} DESC, m.id DESC`;
  }

  async detail(id: string): Promise<EntryDetail | null> {
    const sql = this.sql;
    const row = ((await sql`SELECT * FROM memos WHERE id = ${id} LIMIT 1`) as unknown as Row[])[0];
    if (!row) return null;
    const entry = rowToMemo(row);
    const sourceRows = row.source_id
      ? ((await sql`SELECT * FROM sources WHERE id = ${row.source_id} LIMIT 1`) as unknown as Row[])
      : [];
    const entityRows = (await sql`
      SELECT e.* FROM entities e
      JOIN memo_entities me ON me.entity_id = e.id
      WHERE me.memo_id = ${id}
      ORDER BY e.type, e.name
    `) as unknown as Row[];
    let projectName: string | null = null;
    if (entry.projectId) {
      const projRows = (await sql`SELECT name FROM entities WHERE id = ${entry.projectId} LIMIT 1`) as unknown as Row[];
      projectName = projRows[0] ? (projRows[0].name as string) : null;
    }
    return {
      entry,
      source: sourceRows[0] ? rowToSource(sourceRows[0]) : null,
      entities: entityRows.map(rowToEntity),
      projectName,
    };
  }

  async graphData(projectId: string, opts: { includeEntries: boolean; maxEntries: number }): Promise<ProjectGraphData> {
    const sql = this.sql;
    const entities = (await sql`
      SELECT DISTINCT en.id, en.name, en.type
      FROM entities en
      JOIN memo_entities me ON me.entity_id = en.id
      JOIN memos m ON m.id = me.memo_id
      WHERE m.project_id = ${projectId} AND en.id <> ${projectId}
    `) as unknown as Row[];
    const entries = opts.includeEntries
      ? ((await sql`
          SELECT m.id, m.title, m.type
          FROM memos m
          WHERE m.project_id = ${projectId}
          ORDER BY m.created_at DESC
          LIMIT ${opts.maxEntries}
        `) as unknown as Row[])
      : [];
    const relations = (await sql`
      SELECT source_id, target_id, relation_type
      FROM relations
      WHERE relation_type <> 'belongs_to'
    `) as unknown as Row[];
    const mentions = opts.includeEntries
      ? ((await sql`
          SELECT me.memo_id, me.entity_id
          FROM memo_entities me
          JOIN memos m ON m.id = me.memo_id
          WHERE m.project_id = ${projectId} AND me.entity_id <> ${projectId}
        `) as unknown as Row[])
      : [];
    return {
      entities: entities.map((r) => ({ id: r.id as string, name: r.name as string, type: r.type as string })),
      entries: entries.map((r) => ({ id: r.id as string, title: (r.title as string) ?? "", type: r.type as string })),
      relations: relations.map((r) => ({
        sourceId: r.source_id as string,
        targetId: r.target_id as string,
        relationType: r.relation_type as string,
      })),
      mentions: mentions.map((r) => ({ memoId: r.memo_id as string, entityId: r.entity_id as string })),
    };
  }

  async decisions(projectId: string, limit: number): Promise<Memo[]> {
    const rows = (await this.sql`
      SELECT * FROM memos
      WHERE project_id = ${projectId} AND type = 'decision'
        AND status NOT IN ('rejected') AND valid_to IS NULL
      ORDER BY created_at DESC
      LIMIT ${limit}
    `) as unknown as Row[];
    return rows.map(rowToMemo);
  }

  async byType(projectIds: string[], type: MemoType, asOf: Date | undefined, limit: number): Promise<Memo[]> {
    const sql = this.sql;
    const temporal = asOf
      ? sql`AND valid_from <= ${asOf} AND (valid_to IS NULL OR valid_to > ${asOf})`
      : sql`AND valid_to IS NULL`;
    const rows = (await sql`
      SELECT * FROM memos
      WHERE project_id = ANY(${projectIds}) AND type = ${type}
        AND status NOT IN ('rejected', 'obsolete')
        ${temporal}
      ORDER BY CASE confidence WHEN 'verified' THEN 0 WHEN 'high' THEN 1 WHEN 'medium' THEN 2 ELSE 3 END,
               created_at DESC
      LIMIT ${limit}
    `) as unknown as Row[];
    return rows.map(rowToMemo);
  }

  async moduleNames(projectId: string): Promise<string[]> {
    const rows = (await this.sql`
      SELECT DISTINCT e.name
      FROM entities e
      JOIN memo_entities me ON me.entity_id = e.id
      JOIN memos m ON m.id = me.memo_id
      WHERE e.type = 'module' AND m.project_id = ${projectId}
    `) as unknown as Row[];
    return rows.map((r) => r.name as string);
  }

  async countInProject(projectId: string): Promise<number> {
    const rows = await this.sql`SELECT count(*)::int AS n FROM memos WHERE project_id = ${projectId}`;
    return Number((rows as unknown as Row[])[0]!.n);
  }

  async disputedAreas(
    projectIds: string[],
    limit: number,
  ): Promise<{ entryId: string; area: string; against: string }[]> {
    // Entries hanging off BOTH sides are excluded: those are not caught in the middle of the
    // argument, they are the argument, and warning them about themselves says nothing.
    const rows = (await this.sql`
      SELECT m.id AS entry_id, mine.name AS area, other.name AS against
      FROM relations r
      JOIN entities mine  ON mine.id  IN (r.source_id, r.target_id)
      JOIN entities other ON other.id IN (r.source_id, r.target_id) AND other.id <> mine.id
      JOIN memo_entities me ON me.entity_id = mine.id
      JOIN memos m ON m.id = me.memo_id
        AND m.valid_to IS NULL AND m.project_id = ANY(${projectIds})
      WHERE r.relation_type = 'contradicts' AND mine.type <> 'project' AND other.type <> 'project'
        AND NOT EXISTS (
          SELECT 1 FROM memo_entities x WHERE x.memo_id = m.id AND x.entity_id = other.id
        )
      LIMIT ${limit}
    `) as unknown as Row[];
    return rows.map((r) => ({ entryId: r.entry_id as string, area: r.area as string, against: r.against as string }));
  }
}

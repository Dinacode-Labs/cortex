import { getSql, type Sql } from "@cortex/database";
import type { ContextEntry, ContextEntryType, ContextEntryStatus, Entity, Source } from "@cortex/shared";
import { canonicalize } from "./text.js";
import { rowToContextEntry, rowToEntity, rowToSource, type Row } from "./map.js";

/** Consultas de lectura para la UI / inspección (no semánticas). */

/** Lista los proyectos (entidades de tipo project) con su nº de entradas. */
export async function listProjects(): Promise<{ entity: Entity; entryCount: number }[]> {
  const sql = getSql();
  const rows = (await sql`
    SELECT e.*, count(ce.id)::int AS entry_count
    FROM entities e
    LEFT JOIN context_entries ce ON ce.project_id = e.id
    WHERE e.type = 'project'
    GROUP BY e.id
    ORDER BY e.name
  `) as unknown as Row[];
  return rows.map((r) => ({ entity: rowToEntity(r), entryCount: Number(r.entry_count) }));
}

export interface ListEntriesFilter {
  project?: string;
  type?: ContextEntryType;
  status?: ContextEntryStatus;
  limit?: number;
}

/** Lista entradas de contexto con filtros opcionales, más recientes primero. */
export async function listEntries(filter: ListEntriesFilter = {}): Promise<ContextEntry[]> {
  const sql = getSql();
  let where = sql`WHERE true`;
  if (filter.project) {
    const projectId = await findProjectId(sql, filter.project);
    if (!projectId) return [];
    where = sql`${where} AND ce.project_id = ${projectId}`;
  }
  if (filter.type) where = sql`${where} AND ce.type = ${filter.type}`;
  if (filter.status) where = sql`${where} AND ce.status = ${filter.status}`;

  const rows = (await sql`
    SELECT ce.* FROM context_entries ce
    ${where}
    ORDER BY ce.created_at DESC
    LIMIT ${filter.limit ?? 100}
  `) as unknown as Row[];
  return rows.map(rowToContextEntry);
}

export interface EntryDetail {
  entry: ContextEntry;
  source: Source | null;
  entities: Entity[];
  projectName: string | null;
}

/** Devuelve una entrada con su fuente, entidades enlazadas y proyecto. */
export async function getEntryDetail(id: string): Promise<EntryDetail | null> {
  const sql = getSql();
  const entryRows = (await sql`SELECT * FROM context_entries WHERE id = ${id} LIMIT 1`) as unknown as Row[];
  const row = entryRows[0];
  if (!row) return null;
  const entry = rowToContextEntry(row);

  const sourceRows = row.source_id
    ? ((await sql`SELECT * FROM sources WHERE id = ${row.source_id} LIMIT 1`) as unknown as Row[])
    : [];

  const entityRows = (await sql`
    SELECT e.* FROM entities e
    JOIN context_entry_entities cee ON cee.entity_id = e.id
    WHERE cee.context_entry_id = ${id}
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

async function findProjectId(sql: Sql, project: string): Promise<string | null> {
  const canonical = canonicalize(project);
  const rows = (await sql`
    SELECT id FROM entities WHERE type = 'project' AND canonical_name = ${canonical} LIMIT 1
  `) as unknown as Row[];
  return rows[0] ? (rows[0].id as string) : null;
}

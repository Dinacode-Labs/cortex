import { getSql, type Sql } from "@cortex/database";
import type { ContextEntry, ContextEntryType, ContextEntryStatus, Entity, Source } from "@cortex/shared";
import { findProjectIdByName } from "./projects.js";
import { rowToContextEntry, rowToEntity, rowToSource, type Row } from "./map.js";

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
  /**
   * Which projects the viewer can reach. **The filter goes inside the query**, before ordering
   * and limiting (ADR-0052).
   *
   * Filtering afterwards does not filter: it truncates. The home page asked for the 60 most
   * recent entries across all projects and discarded the inaccessible ones in memory, so it was
   * enough for those 60 to belong to other people's projects -- or to none -- for the screen to
   * come out empty while hundreds of visible entries existed. Measured: 452 accessible, 0 shown.
   *
   * Without this field everything is listed: that is for callers who already know they may see
   * it (an admin, an internal process). Anyone serving a person should pass it.
   */
  accessibleProjectIds?: string[];
}

/** Lists context entries with optional filters, newest first. */
export async function listEntries(filter: ListEntriesFilter = {}): Promise<ContextEntry[]> {
  const sql = getSql();
  let where = sql`WHERE true`;
  if (filter.project) {
    const projectId = await findProjectIdByName(sql, filter.project);
    if (!projectId) return [];
    where = sql`${where} AND ce.project_id = ${projectId}`;
  } else if (filter.accessibleProjectIds) {
    // An entry with no project is visible to anyone with a session: there is no project to
    // restrict it (the same rule as `checkEntryAccess`, which returns `ok` with `project: null`).
    where = sql`${where} AND (ce.project_id IS NULL OR ce.project_id = ANY(${filter.accessibleProjectIds}))`;
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

export interface GraphNode {
  id: string;
  label: string;
  group: string;
  kind: "entity" | "entry";
}
export interface GraphEdge {
  from: string;
  to: string;
  label?: string;
  kind: "relation" | "mention";
}
export interface ProjectGraph {
  nodes: GraphNode[];
  edges: GraphEdge[];
}

/**
 * A project's knowledge graph, for visualisation: entities plus (optionally) entries as nodes;
 * relations and mentions (entry -> entity) as edges.
 */
export async function getProjectGraph(
  project: string,
  opts: { includeEntries?: boolean; maxEntries?: number } = {},
): Promise<ProjectGraph> {
  const sql = getSql();
  const projectId = await findProjectIdByName(sql, project);
  if (!projectId) return { nodes: [], edges: [] };
  const includeEntries = opts.includeEntries ?? true;
  const maxEntries = opts.maxEntries ?? 500;

  const entityRows = (await sql`
    SELECT DISTINCT en.id, en.name, en.type
    FROM entities en
    JOIN context_entry_entities cee ON cee.entity_id = en.id
    JOIN context_entries ce ON ce.id = cee.context_entry_id
    WHERE ce.project_id = ${projectId} AND en.id <> ${projectId}
  `) as unknown as Row[];

  const nodeIds = new Set<string>();
  const nodes: GraphNode[] = [];
  for (const r of entityRows) {
    nodeIds.add(r.id);
    nodes.push({ id: r.id, label: r.name, group: r.type, kind: "entity" });
  }

  if (includeEntries) {
    const entryRows = (await sql`
      SELECT ce.id, ce.title, ce.type
      FROM context_entries ce
      WHERE ce.project_id = ${projectId}
      ORDER BY ce.created_at DESC
      LIMIT ${maxEntries}
    `) as unknown as Row[];
    for (const r of entryRows) {
      nodeIds.add(r.id);
      const title = (r.title as string) ?? "";
      nodes.push({ id: r.id, label: title.length > 48 ? `${title.slice(0, 45)}…` : title, group: `entry:${r.type}`, kind: "entry" });
    }
  }

  const edges: GraphEdge[] = [];
  const relRows = (await sql`
    SELECT source_id, target_id, relation_type
    FROM relations
    WHERE relation_type <> 'belongs_to'
  `) as unknown as Row[];
  for (const r of relRows) {
    if (nodeIds.has(r.source_id) && nodeIds.has(r.target_id)) {
      edges.push({ from: r.source_id, to: r.target_id, label: r.relation_type, kind: "relation" });
    }
  }
  if (includeEntries) {
    const linkRows = (await sql`
      SELECT cee.context_entry_id, cee.entity_id
      FROM context_entry_entities cee
      JOIN context_entries ce ON ce.id = cee.context_entry_id
      WHERE ce.project_id = ${projectId} AND cee.entity_id <> ${projectId}
    `) as unknown as Row[];
    for (const r of linkRows) {
      if (nodeIds.has(r.context_entry_id) && nodeIds.has(r.entity_id)) {
        edges.push({ from: r.context_entry_id, to: r.entity_id, kind: "mention" });
      }
    }
  }

  return { nodes, edges };
}


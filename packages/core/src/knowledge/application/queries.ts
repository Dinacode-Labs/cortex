import type { Entity } from "@cortex/shared";
import { port } from "../../composition.js";
import { findProjectIdByName } from "../../projects/application/projects.js";
import type { EntryDetail, EntrySort } from "../domain/memo-reader.js";
import type { Memo, MemoStatus, MemoType } from "../domain/memo.js";

export type { EntryDetail, EntrySort } from "../domain/memo-reader.js";

export async function listProjects(): Promise<{ entity: Entity; entryCount: number }[]> {
  return port("memoReader").projectsWithCounts();
}

export interface ListEntriesFilter {
  project?: string;
  type?: MemoType;
  status?: MemoStatus;
  limit?: number;
  sort?: EntrySort;
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

export async function listEntries(filter: ListEntriesFilter = {}): Promise<Memo[]> {
  let projectId: string | undefined;
  if (filter.project) {
    projectId = (await findProjectIdByName(filter.project)) ?? undefined;
    if (!projectId) return [];
  }
  return port("memoReader").list({
    projectId,
    accessibleProjectIds: projectId ? undefined : filter.accessibleProjectIds,
    type: filter.type,
    status: filter.status,
    limit: filter.limit ?? 100,
    sort: filter.sort ?? { by: "created", dir: "desc" },
  });
}

export async function getEntryDetail(id: string): Promise<EntryDetail | null> {
  return port("memoReader").detail(id);
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

export async function getProjectGraph(
  project: string,
  opts: { includeEntries?: boolean; maxEntries?: number } = {},
): Promise<ProjectGraph> {
  const projectId = await findProjectIdByName(project);
  if (!projectId) return { nodes: [], edges: [] };
  const data = await port("memoReader").graphData(projectId, {
    includeEntries: opts.includeEntries ?? true,
    maxEntries: opts.maxEntries ?? 500,
  });

  const nodeIds = new Set<string>();
  const nodes: GraphNode[] = [];
  for (const e of data.entities) {
    nodeIds.add(e.id);
    nodes.push({ id: e.id, label: e.name, group: e.type, kind: "entity" });
  }
  for (const e of data.entries) {
    nodeIds.add(e.id);
    const label = e.title.length > 48 ? `${e.title.slice(0, 45)}…` : e.title;
    nodes.push({ id: e.id, label, group: `entry:${e.type}`, kind: "entry" });
  }

  const edges: GraphEdge[] = [];
  for (const r of data.relations) {
    if (nodeIds.has(r.sourceId) && nodeIds.has(r.targetId)) {
      edges.push({ from: r.sourceId, to: r.targetId, label: r.relationType, kind: "relation" });
    }
  }
  for (const m of data.mentions) {
    if (nodeIds.has(m.memoId) && nodeIds.has(m.entityId)) edges.push({ from: m.memoId, to: m.entityId, kind: "mention" });
  }
  return { nodes, edges };
}

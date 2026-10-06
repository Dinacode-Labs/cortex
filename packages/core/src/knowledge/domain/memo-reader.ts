import type { Entity, EntrySortField, SortDirection, Source } from "@cortex/shared";
import type { Memo, MemoStatus, MemoType } from "./memo.js";

export interface EntrySort {
  by: EntrySortField;
  dir: SortDirection;
}

export interface MemoListFilter {
  projectId?: string;
  /** Applied inside the query, before ordering and limiting (ADR-0052): filtering afterwards truncates. */
  accessibleProjectIds?: string[];
  type?: MemoType;
  status?: MemoStatus;
  limit: number;
  sort: EntrySort;
}

export interface EntryDetail {
  entry: Memo;
  source: Source | null;
  entities: Entity[];
  projectName: string | null;
}

export interface ProjectGraphData {
  entities: { id: string; name: string; type: string }[];
  entries: { id: string; title: string; type: string }[];
  relations: { sourceId: string; targetId: string; relationType: string }[];
  mentions: { memoId: string; entityId: string }[];
}

export interface MemoReader {
  projectsWithCounts(): Promise<{ entity: Entity; entryCount: number }[]>;
  list(filter: MemoListFilter): Promise<Memo[]>;
  detail(id: string): Promise<EntryDetail | null>;
  graphData(projectId: string, opts: { includeEntries: boolean; maxEntries: number }): Promise<ProjectGraphData>;
  decisions(projectId: string, limit: number): Promise<Memo[]>;
  /** Current (or as of `asOf`), not rejected nor obsolete, the most reliable first. */
  byType(projectIds: string[], type: MemoType, asOf: Date | undefined, limit: number): Promise<Memo[]>;
  moduleNames(projectId: string): Promise<string[]>;
  countInProject(projectId: string): Promise<number>;
  /** Entities recorded as contradicting each other, and the current memos hanging off one side only. */
  disputedAreas(projectIds: string[], limit: number): Promise<{ entryId: string; area: string; against: string }[]>;
}

import type { ProjectChainNode, ProjectRef } from "./project.js";

/**
 * The port the projects module reads through. It covers resolution and the ancestor chain --
 * what the access policy needs -- plus the listings; the mutations (create/update/delete,
 * members) still live next to their use cases for now.
 */
export interface ProjectRepository {
  /** Slug first, then canonical name (ADR-0043/0061). */
  findByRef(ref: string): Promise<ProjectRef | null>;
  findBySlug(slug: string): Promise<ProjectRef | null>;
  findIdByRef(ref: string): Promise<string | null>;
  resolveEntryProject(entryId: string): Promise<{ found: boolean; project: ProjectRef | null }>;
  chain(projectId: string): Promise<ProjectChainNode[]>;
  isMember(projectId: string, email: string): Promise<boolean>;
  idsWithAncestors(projectId: string): Promise<string[]>;
  ancestors(projectId: string): Promise<ProjectRef[]>;
  listAll(): Promise<ProjectRef[]>;
  entryCounts(): Promise<Map<string, number>>;
}

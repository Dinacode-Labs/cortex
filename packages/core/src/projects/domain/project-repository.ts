import type { ProjectChainNode, ProjectRef } from "./project.js";

/** A project to create, before it has an id. */
export interface NewProject {
  name: string;
  slug: string;
  visibility: "public" | "private";
  ownerEmail: string | null;
  parentId: string | null;
}

/** The fields a project can change after creation (see ADR-0051/0056). */
export interface ProjectChanges {
  visibility: "public" | "private";
  ownerEmail: string | null;
  parentId: string | null;
}

/**
 * The port the projects module reads and writes through. It covers resolution, the ancestor
 * chain and the listings, plus the mutations (create/update/delete, members); the pg adapter
 * lives in `infrastructure/`.
 */
export interface ProjectRepository {
  /** Slug first, then canonical name (ADR-0043/0061). */
  findByRef(ref: string): Promise<ProjectRef | null>;
  findBySlug(slug: string): Promise<ProjectRef | null>;
  findIdByRef(ref: string): Promise<string | null>;
  findByCanonicalName(name: string): Promise<ProjectRef | null>;
  resolveEntryProject(entryId: string): Promise<{ found: boolean; project: ProjectRef | null }>;
  chain(projectId: string): Promise<ProjectChainNode[]>;
  isMember(projectId: string, email: string): Promise<boolean>;
  idsWithAncestors(projectId: string): Promise<string[]>;
  ancestors(projectId: string): Promise<ProjectRef[]>;
  listAll(): Promise<ProjectRef[]>;
  entryCounts(): Promise<Map<string, number>>;
  /** Creates it whole (with slug); null when the canonical name already exists. */
  insert(project: NewProject): Promise<ProjectRef | null>;
  parentIdOf(id: string): Promise<string | null>;
  update(id: string, changes: ProjectChanges): Promise<void>;
  countEntries(projectId: string): Promise<number>;
  countChildren(projectId: string): Promise<number>;
  remove(id: string): Promise<void>;
  addMember(projectId: string, email: string): Promise<void>;
  removeMember(projectId: string, email: string): Promise<void>;
  listMembers(projectId: string): Promise<string[]>;
}

import { defaultLanguage, projectCriteria, type Language, type ProjectCriteria } from "@cortex/shared";
import { isAdmin } from "../../auth/auth.js";
import type { SessionUser } from "../../auth/session-user.js";
import { slugify } from "../domain/slug.js";
import { decideProjectAccess, effectiveCriteria, effectiveLanguage, type ProjectRef } from "../domain/project.js";
import { port } from "../../composition.js";

export type { ProjectRef } from "../domain/project.js";

/** By slug or canonical name: different casing or accents must not create new projects nor skip the dedup. */
export async function findProjectIdByName(project: string): Promise<string | null> {
  return port("projects").findIdByRef(project);
}

export async function findProjectBySlug(slug: string): Promise<ProjectRef | null> {
  return port("projects").findBySlug(slug);
}

/** By slug or canonical name: what an agent or a person types into `project`. It used to
 * compare the EXACT name, so the MCP guard rejected what the data operations did find. */
export async function findProjectByName(name: string): Promise<ProjectRef | null> {
  return port("projects").findByRef(name);
}

export async function getEntryProject(entryId: string): Promise<ProjectRef | null> {
  return (await port("projects").resolveEntryProject(entryId)).project;
}

export async function createProject(
  name: string,
  opts?: { visibility?: "public" | "private"; ownerEmail?: string | null; parentSlug?: string | null },
): Promise<ProjectRef> {
  const repository = port("projects");
  let parentId: string | null = null;
  if (opts?.parentSlug) {
    const parent = await findProjectBySlug(opts.parentSlug);
    if (!parent) throw new Error(`Parent project "${opts.parentSlug}" not found.`);
    parentId = parent.id;
  }
  const slug = slugify(name);
  // The slug is the IDENTITY: when it already exists we do NOT invent a slug-2 -- the existing
  // one is returned so the caller decides (access / request permission). See link.ts.
  const bySlug = await findProjectBySlug(slug);
  if (bySlug) return bySlug;
  // The project is born whole, with its slug: the database does not accept a `project`
  // without one (#135), so inserting the name and filling in later is not an option. When the
  // canonical name already exists with a different slug, that one is returned as is, as before.
  const inserted = await repository.insert({
    name,
    slug,
    visibility: opts?.visibility ?? "public",
    ownerEmail: opts?.ownerEmail ?? null,
    parentId,
  });
  return inserted ?? (await repository.findByCanonicalName(name))!;
}

export interface ProjectLanguage {
  own: Language | null;
  effective: Language;
}

export async function languageOfProject(projectId: string | null): Promise<ProjectLanguage> {
  if (!projectId) return { own: null, effective: defaultLanguage() };
  const chain = (await port("projects").settingsChain(projectId)).map((s) => s.language);
  return { own: chain[0] ?? null, effective: effectiveLanguage(chain, defaultLanguage()) };
}

export async function getProjectLanguage(ref: string): Promise<ProjectLanguage> {
  return languageOfProject(await port("projects").findIdByRef(ref));
}

export interface ProjectCriteriaView {
  own: ProjectCriteria | null;
  inherited: ProjectCriteria;
  effective: ProjectCriteria;
}

function parseStoredCriteria(raw: unknown): ProjectCriteria | null {
  if (raw === null || raw === undefined) return null;
  const parsed = projectCriteria.safeParse(raw);
  return parsed.success ? parsed.data : null;
}

export async function criteriaOfProject(projectId: string | null): Promise<ProjectCriteriaView> {
  if (!projectId) return { own: null, inherited: effectiveCriteria([]), effective: effectiveCriteria([]) };
  const settings = await port("projects").settingsChain(projectId);
  const chain = settings.map((s) => parseStoredCriteria(s.criteria));
  return { own: chain[0] ?? null, inherited: effectiveCriteria(chain.slice(1)), effective: effectiveCriteria(chain) };
}

export async function getProjectCriteria(ref: string): Promise<ProjectCriteriaView> {
  return criteriaOfProject(await port("projects").findIdByRef(ref));
}

export async function isProjectMember(projectId: string, email: string): Promise<boolean> {
  return port("projects").isMember(projectId, email);
}

/**
 * Can `viewer` access the project? It cascades through the hierarchy: if the project OR any
 * ANCESTOR is private -> restricted; access is granted by being an admin, or owner/member of
 * the project or of any ancestor (membership of the parent "Acme" opens its sub-projects).
 */
export async function canAccessProject(project: ProjectRef, viewer: SessionUser | null): Promise<boolean> {
  const repository = port("projects");
  const chain = await repository.chain(project.id);
  return decideProjectAccess(chain, viewer, {
    isAdmin: isAdmin(viewer),
    isMember: (projectId) => repository.isMember(projectId, viewer!.email),
  });
}

/**
 * The project and its whole ancestor chain, from child to root.
 *
 * The context pack and search use it: a child project inherits what its client knows. Going up
 * is safe because `canAccessProject` looks at the entire chain -- if an ancestor is private the
 * child is restricted -- so having access to the child implies having it to all its parents.
 */
export async function projectIdsWithAncestors(projectId: string): Promise<string[]> {
  return port("projects").idsWithAncestors(projectId);
}

/**
 * A project's ancestors, from the ROOT to the direct parent (the project itself is excluded).
 * It deliberately does not filter by permissions: access to the child implies access to all
 * its parents.
 */
export async function listProjectAncestors(projectId: string): Promise<ProjectRef[]> {
  return port("projects").ancestors(projectId);
}

export type AccessCheck =
  | { status: "ok"; project: ProjectRef }
  | { status: "not_found" }
  | { status: "forbidden" };

/**
 * The ONE project-access policy for the apps (MCP, API, web). It resolves the project by
 * `slug` (when given) or by `name` and applies `canAccessProject`:
 * - project does not exist -> `not_found` (WRITE callers working by name may read this as
 *   "it will be created", because save auto-creates the project; see the ADR),
 * - exists, no permission -> `forbidden`,
 * - exists, with permission -> `ok` plus the resolved ProjectRef.
 * Neither `name` nor `slug` is a caller bug -> Error.
 */
export async function checkProjectAccess(
  viewer: SessionUser | null,
  ref: { name?: string; slug?: string },
): Promise<AccessCheck> {
  if (!ref.slug && !ref.name) throw new Error("checkProjectAccess: 'name' or 'slug' is required (caller bug).");
  const project = ref.slug ? await findProjectBySlug(ref.slug) : await findProjectByName(ref.name!);
  if (!project) return { status: "not_found" };
  if (!(await canAccessProject(project, viewer))) return { status: "forbidden" };
  return { status: "ok", project };
}

/**
 * Access through an entry id (validate, relate...): the permission comes from the entry's
 * project.
 * - entry does not exist -> `not_found`,
 * - entry with no project -> `ok` with `project: null` (there are no permissions to apply),
 * - the entry's project without permission -> `forbidden`.
 */
export async function checkEntryAccess(
  viewer: SessionUser | null,
  entryId: string,
): Promise<{ status: "ok"; project: ProjectRef | null } | { status: "not_found" } | { status: "forbidden" }> {
  const { found, project } = await port("projects").resolveEntryProject(entryId);
  if (!found) return { status: "not_found" };
  if (project && !(await canAccessProject(project, viewer))) return { status: "forbidden" };
  return { status: "ok", project };
}

export interface AccessibleProject extends ProjectRef {
  entryCount: number;
}

/**
 * Projects visible to `viewer`: an admin sees them all; everyone else sees the public ones plus
 * the private ones they own or were given. It includes `entryCount` from ONE aggregate query
 * (GROUP BY project_id) merged by id -- not one query per project.
 */
export async function listAccessibleProjects(viewer: SessionUser | null): Promise<AccessibleProject[]> {
  const repository = port("projects");
  const counts = await repository.entryCounts();
  const refs = (await repository.listAll()).map((r): AccessibleProject => ({ ...r, entryCount: counts.get(r.id) ?? 0 }));
  if (isAdmin(viewer)) return refs;
  const out: AccessibleProject[] = [];
  for (const r of refs) if (await canAccessProject(r, viewer)) out.push(r);
  return out;
}

/**
 * The DIRECT children of a project that `viewer` can see.
 *
 * Going down the hierarchy is not the same as going up: inheritance goes up (a child reads the
 * client's knowledge) because access to the child already implies access to the parent. The
 * same reasoning does not hold in reverse -- a private child you are not a member of does not
 * become visible by looking at the parent -- so anything crossing downwards goes through here
 * and inherits `listAccessibleProjects`'s filter.
 */
export async function listChildProjects(parentId: string, viewer: SessionUser | null): Promise<AccessibleProject[]> {
  return (await listAccessibleProjects(viewer)).filter((p) => p.parentId === parentId);
}

/**
 * Who may **manage** a project: its owner or a global admin (ADR-0051).
 *
 * Only the admin used to rule, and the guard lived in the web -- the domain trusted that the
 * caller had checked. That made the admin a bottleneck for any team and left the owner of a
 * private project unable to add anyone to their own. The question is now answered once, and
 * here, which is where it cannot be forgotten.
 *
 * Managing means changing visibility, transferring ownership and touching the member list. It
 * is not reading: that is decided by `canAccessProject`, which is a different question.
 */
export async function canManageProject(actor: SessionUser | null, slug: string): Promise<boolean> {
  if (!actor) return false;
  if (isAdmin(actor)) return true;
  const p = await findProjectBySlug(slug);
  return !!p && p.ownerEmail?.toLowerCase() === actor.email.toLowerCase();
}

/** What `canManageProject` allows, so the message is not repeated in every caller. */
export class NotAManagerError extends Error {
  constructor(slug: string) {
    super(`Only the owner of "${slug}" or an administrator can change this.`);
    this.name = "NotAManagerError";
  }
}

async function requireManager(slug: string, actor: SessionUser | null): Promise<ProjectRef> {
  const p = await findProjectBySlug(slug);
  if (!p) throw new Error(`Project "${slug}" not found.`);
  if (!(await canManageProject(actor, slug))) throw new NotAManagerError(slug);
  return p;
}

/** Access is decided live, so going private takes effect at once everywhere and touches no memo. */
export async function updateProject(
  slug: string,
  changes: {
    visibility?: "public" | "private";
    ownerEmail?: string | null;
    parentSlug?: string | null;
    language?: Language | null;
    criteria?: ProjectCriteria | null;
  },
  actor: SessionUser | null,
): Promise<ProjectRef> {
  const repository = port("projects");
  const p = await requireManager(slug, actor);
  const visibility = changes.visibility ?? p.visibility;
  const ownerEmail =
    changes.ownerEmail === undefined ? p.ownerEmail : changes.ownerEmail ? changes.ownerEmail.toLowerCase() : null;

  // Hanging a project under a parent after creating it (ADR-0056). The case that asks for it is
  // the usual one: a client with several repos that are not a monorepo, and someone on the team
  // creating one of the children without `--parent` because they were in a hurry. Without this
  // there was no fix -- neither re-attaching nor recreating, because the slug was already taken
  // -- and the client's memory stayed split in two.
  let parentId = p.parentId;
  if (changes.parentSlug !== undefined) {
    if (changes.parentSlug === null) parentId = null;
    else {
      const parent = await findProjectBySlug(changes.parentSlug);
      if (!parent) throw new Error(`Parent project "${changes.parentSlug}" not found.`);
      if (parent.id === p.id) throw new Error("A project cannot be its own parent.");
      // Permissions and the pack climb the ancestor chain: a cycle would leave them going round
      // forever, so it is checked before writing rather than after.
      let cursor: string | null = parent.parentId;
      while (cursor) {
        if (cursor === p.id) throw new Error(`"${changes.parentSlug}" already hangs under "${slug}": that would be a cycle.`);
        cursor = await repository.parentIdOf(cursor);
      }
      parentId = parent.id;
    }
  }

  await repository.update(p.id, { visibility, ownerEmail, parentId });
  if (changes.language !== undefined) await repository.setLanguage(p.id, changes.language);
  if (changes.criteria !== undefined) await repository.setCriteria(p.id, changes.criteria);
  return { ...p, visibility, ownerEmail, parentId };
}

/**
 * Deletes an EMPTY project.
 *
 * It undoes a mistaken `cortex link --create`, and nothing else (ADR-0057). If the project has
 * so much as one entry or one child, this refuses: deleting it would destroy memory, and in a
 * product whose principle is that invalidating is not deleting, that cannot be one click away.
 * For that case there is a database, a backup and a decision taken slowly.
 *
 * The owner can do it, not only an admin: someone who mistypes a name should be able to fix it
 * without writing to anybody, and there is nothing here to destroy.
 */
export async function deleteProject(slug: string, actor: SessionUser | null): Promise<void> {
  const repository = port("projects");
  const p = await requireManager(slug, actor);
  const entries = await repository.countEntries(p.id);
  if (entries > 0) {
    throw new ProjectNotEmptyError(`"${slug}" has ${entries} entries. Only an empty project can be deleted.`);
  }
  const children = await repository.countChildren(p.id);
  if (children > 0) {
    throw new ProjectNotEmptyError(`"${slug}" still has ${children} child project(s). Move them out first.`);
  }
  await repository.remove(p.id);
}

/** Refuses to delete something that holds memory. It is a 409, not a server error. */
export class ProjectNotEmptyError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ProjectNotEmptyError";
  }
}

/** Adds a member. Owner or admin only (ADR-0051). */
export async function addProjectMember(slug: string, email: string, actor: SessionUser | null): Promise<void> {
  const p = await requireManager(slug, actor);
  await port("projects").addMember(p.id, email);
}

/** Removes a member. Owner or admin only (ADR-0051). */
export async function removeProjectMember(slug: string, email: string, actor: SessionUser | null): Promise<void> {
  const p = await requireManager(slug, actor);
  await port("projects").removeMember(p.id, email);
}

export async function listProjectMembers(slug: string): Promise<string[]> {
  const p = await findProjectBySlug(slug);
  if (!p) return [];
  return port("projects").listMembers(p.id);
}

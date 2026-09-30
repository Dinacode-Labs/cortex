import { getSql, type Sql } from "@cortex/database";
import { isAdmin } from "../identity/auth.js";
import { readCortexLink } from "@cortex/client";
import { slugify } from "./project-config.js";
import { canonicalize } from "../text.js";
import type { Row } from "../storage/map.js";
import { decideProjectAccess, type ProjectRef } from "./domain/project.js";
import { PgProjectRepository } from "./infrastructure/project.repository.js";

export type { ProjectRef } from "./domain/project.js";

/** A project's id by slug or canonical name (see `PgProjectRepository.findByRef`). For data
 * operations: different casing or accents must not create new projects nor skip the dedup. */
export async function findProjectIdByName(sql: Sql, project: string): Promise<string | null> {
  return new PgProjectRepository(sql).findIdByRef(project);
}

export async function findProjectBySlug(slug: string): Promise<ProjectRef | null> {
  return new PgProjectRepository(getSql()).findBySlug(slug);
}

/** By slug or canonical name: what an agent or a person types into `project`. It used to
 * compare the EXACT name, so the MCP guard rejected what the data operations did find. */
export async function findProjectByName(name: string): Promise<ProjectRef | null> {
  return new PgProjectRepository(getSql()).findByRef(name);
}

export async function getEntryProject(entryId: string): Promise<ProjectRef | null> {
  return (await new PgProjectRepository(getSql()).resolveEntryProject(entryId)).project;
}

export async function createProject(
  name: string,
  opts?: { visibility?: "public" | "private"; ownerEmail?: string | null; parentSlug?: string | null },
): Promise<ProjectRef> {
  const sql = getSql();
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
  const visibility = opts?.visibility ?? "public";
  const inserted = (await sql`
    INSERT INTO entities (name, canonical_name, type, slug, visibility, owner_email, parent_id)
    VALUES (${name}, ${canonicalize(name)}, 'project', ${slug}, ${visibility}, ${opts?.ownerEmail ?? null}, ${parentId})
    ON CONFLICT (type, canonical_name) DO NOTHING
    RETURNING id, name, slug, visibility, owner_email, parent_id
  `) as unknown as Row[];
  const ins = inserted[0];
  if (ins) return toRef(ins);
  const byName = (await sql`
    SELECT id, name, slug, visibility, owner_email, parent_id FROM entities
    WHERE type = 'project' AND canonical_name = ${canonicalize(name)} LIMIT 1
  `) as unknown as Row[];
  return toRef(byName[0]!);
}

// The mutations below still own their SQL: they are single writes with a manager check, and
// moving them behind a port is a further slice.

export async function isProjectMember(projectId: string, email: string): Promise<boolean> {
  return new PgProjectRepository(getSql()).isMember(projectId, email);
}

/**
 * Can `email` access the project? It cascades through the hierarchy: if the project OR any
 * ANCESTOR is private -> restricted; access is granted by being an admin, or owner/member of
 * the project or of any ancestor (membership of the parent "Acme" opens its sub-projects).
 */
export async function canAccessProject(project: ProjectRef, email: string | null): Promise<boolean> {
  const repository = new PgProjectRepository(getSql());
  const chain = await repository.chain(project.id);
  return decideProjectAccess(chain, email, {
    isAdmin: email ? isAdmin(email) : false,
    isMember: (projectId) => repository.isMember(projectId, email!),
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
  return new PgProjectRepository(getSql()).idsWithAncestors(projectId);
}

/**
 * A project's ancestors, from the ROOT to the direct parent (the project itself is excluded).
 * It deliberately does not filter by permissions: access to the child implies access to all
 * its parents.
 */
export async function listProjectAncestors(projectId: string): Promise<ProjectRef[]> {
  return new PgProjectRepository(getSql()).ancestors(projectId);
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
  email: string | null,
  ref: { name?: string; slug?: string },
): Promise<AccessCheck> {
  if (!ref.slug && !ref.name) throw new Error("checkProjectAccess: 'name' or 'slug' is required (caller bug).");
  const project = ref.slug ? await findProjectBySlug(ref.slug) : await findProjectByName(ref.name!);
  if (!project) return { status: "not_found" };
  if (!(await canAccessProject(project, email))) return { status: "forbidden" };
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
  email: string | null,
  entryId: string,
): Promise<{ status: "ok"; project: ProjectRef | null } | { status: "not_found" } | { status: "forbidden" }> {
  const { found, project } = await new PgProjectRepository(getSql()).resolveEntryProject(entryId);
  if (!found) return { status: "not_found" };
  if (project && !(await canAccessProject(project, email))) return { status: "forbidden" };
  return { status: "ok", project };
}

export interface AccessibleProject extends ProjectRef {
  entryCount: number;
}

/**
 * Projects visible to `email`: an admin sees them all; everyone else sees the public ones plus
 * the private ones they own or were given. It includes `entryCount` from ONE aggregate query
 * (GROUP BY project_id) merged by id -- not one query per project.
 */
export async function listAccessibleProjects(email: string | null): Promise<AccessibleProject[]> {
  const repository = new PgProjectRepository(getSql());
  const counts = await repository.entryCounts();
  const refs = (await repository.listAll()).map((r): AccessibleProject => ({ ...r, entryCount: counts.get(r.id) ?? 0 }));
  if (isAdmin(email)) return refs;
  const out: AccessibleProject[] = [];
  for (const r of refs) if (await canAccessProject(r, email)) out.push(r);
  return out;
}

/**
 * The DIRECT children of a project that `email` can see.
 *
 * Going down the hierarchy is not the same as going up: inheritance goes up (a child reads the
 * client's knowledge) because access to the child already implies access to the parent. The
 * same reasoning does not hold in reverse -- a private child you are not a member of does not
 * become visible by looking at the parent -- so anything crossing downwards goes through here
 * and inherits `listAccessibleProjects`'s filter.
 */
export async function listChildProjects(parentId: string, email: string | null): Promise<AccessibleProject[]> {
  return (await listAccessibleProjects(email)).filter((p) => p.parentId === parentId);
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
export async function canManageProject(email: string | null, slug: string): Promise<boolean> {
  if (!email) return false;
  if (isAdmin(email)) return true;
  const p = await findProjectBySlug(slug);
  return !!p && p.ownerEmail?.toLowerCase() === email.toLowerCase();
}

/** What `canManageProject` allows, so the message is not repeated in every caller. */
export class NotAManagerError extends Error {
  constructor(slug: string) {
    super(`Only the owner of "${slug}" or an administrator can change this.`);
    this.name = "NotAManagerError";
  }
}

async function requireManager(slug: string, byEmail: string | null): Promise<ProjectRef> {
  const p = await findProjectBySlug(slug);
  if (!p) throw new Error(`Project "${slug}" not found.`);
  if (!(await canManageProject(byEmail, slug))) throw new NotAManagerError(slug);
  return p;
}

/**
 * Changes what a project can change after birth: its visibility and its owner.
 *
 * The absence of this was ADR-0036's big hole: a project created public stayed public forever,
 * in every interface, because the repository's only `UPDATE ... visibility` ran at creation
 * time. Turning it private takes effect immediately and affects everything -- search, packs,
 * listings -- because the policy consults them live; it touches no entry.
 */
export async function updateProject(
  slug: string,
  changes: { visibility?: "public" | "private"; ownerEmail?: string | null; parentSlug?: string | null },
  byEmail: string | null,
): Promise<ProjectRef> {
  const p = await requireManager(slug, byEmail);
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
      const sql = getSql();
      let cursor: string | null = parent.parentId;
      while (cursor) {
        if (cursor === p.id) throw new Error(`"${changes.parentSlug}" already hangs under "${slug}": that would be a cycle.`);
        const rows = (await sql`SELECT parent_id FROM entities WHERE id = ${cursor}`) as unknown as Row[];
        cursor = (rows[0]?.parent_id as string | null) ?? null;
      }
      parentId = parent.id;
    }
  }

  await getSql()`
    UPDATE entities SET visibility = ${visibility}, owner_email = ${ownerEmail}, parent_id = ${parentId}
    WHERE id = ${p.id}`;
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
export async function deleteProject(slug: string, byEmail: string | null): Promise<void> {
  const p = await requireManager(slug, byEmail);
  const sql = getSql();
  const [entries] = (await sql`SELECT count(*)::int AS n FROM context_entries WHERE project_id = ${p.id}`) as unknown as Row[];
  if (Number(entries?.n ?? 0) > 0) {
    throw new ProjectNotEmptyError(`"${slug}" has ${entries!.n} entries. Only an empty project can be deleted.`);
  }
  const [children] = (await sql`SELECT count(*)::int AS n FROM entities WHERE parent_id = ${p.id}`) as unknown as Row[];
  if (Number(children?.n ?? 0) > 0) {
    throw new ProjectNotEmptyError(`"${slug}" still has ${children!.n} child project(s). Move them out first.`);
  }
  await sql`DELETE FROM entities WHERE id = ${p.id}`;
}

/** Refuses to delete something that holds memory. It is a 409, not a server error. */
export class ProjectNotEmptyError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ProjectNotEmptyError";
  }
}

/** Adds a member. Owner or admin only (ADR-0051). */
export async function addProjectMember(slug: string, email: string, byEmail: string | null): Promise<void> {
  const p = await requireManager(slug, byEmail);
  await getSql()`INSERT INTO project_members (project_id, email) VALUES (${p.id}, ${email.toLowerCase()}) ON CONFLICT DO NOTHING`;
}

/** Removes a member. Owner or admin only (ADR-0051). */
export async function removeProjectMember(slug: string, email: string, byEmail: string | null): Promise<void> {
  const p = await requireManager(slug, byEmail);
  await getSql()`DELETE FROM project_members WHERE project_id = ${p.id} AND email = ${email.toLowerCase()}`;
}

export async function listProjectMembers(slug: string): Promise<string[]> {
  const p = await findProjectBySlug(slug);
  if (!p) return [];
  const rows = (await getSql()`SELECT email FROM project_members WHERE project_id = ${p.id} ORDER BY email`) as unknown as Row[];
  return rows.map((r) => r.email as string);
}

/**
 * Resolves the project LINKED to a directory (it reads `.cortex.json`). It does NOT create:
 * when the slug does not exist in Cortex (or there is an opt-out, or no `.cortex.json`), it
 * returns null.
 */
export async function resolveLinkedProject(cwd: string): Promise<ProjectRef | null> {
  const link = readCortexLink(cwd);
  if (!link || link.ignore === true) return null;
  if (link.slug) return findProjectBySlug(link.slug);
  if (link.project) return findProjectByName(link.project);
  return null;
}

// `createProject` builds the ProjectRef it returns from the raw INSERT row.
function toRef(r: Row): ProjectRef {
  return {
    id: r.id as string,
    name: r.name as string,
    slug: (r.slug as string) ?? null,
    visibility: ((r.visibility as string) ?? "public") === "private" ? "private" : "public",
    ownerEmail: (r.owner_email as string) ?? null,
    parentId: (r.parent_id as string) ?? null,
  };
}

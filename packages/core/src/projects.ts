import { getSql, type Sql } from "@cortex/database";
import { resolveEntity } from "./entities.js";
import { isAdmin } from "./auth.js";
import { readCortexLink, slugify } from "./project-config.js";
import { canonicalize } from "./text.js";
import type { Row } from "./map.js";

/** Referencia a un proyecto (entidad type='project') con visibilidad y dueño. */
export interface ProjectRef {
  id: string;
  name: string;
  slug: string | null;
  visibility: "public" | "private";
  ownerEmail: string | null;
  parentId: string | null;
}

function toRef(r: Row | undefined): ProjectRef | null {
  if (!r) return null;
  return {
    id: r.id as string,
    name: r.name as string,
    slug: (r.slug as string) ?? null,
    visibility: ((r.visibility as string) ?? "public") === "private" ? "private" : "public",
    ownerEmail: (r.owner_email as string) ?? null,
    parentId: (r.parent_id as string) ?? null,
  };
}

/**
 * Id de un proyecto por nombre con la semántica CANÓNICA del repo (`canonical_name`:
 * minúsculas, sin acentos) — la ÚNICA resolución por nombre para operaciones de datos;
 * mayúsculas o acentos distintos no deben crear proyectos nuevos ni saltarse el dedup.
 */
export async function findProjectIdByName(sql: Sql, project: string): Promise<string | null> {
  const rows = (await sql`
    SELECT id FROM entities WHERE type = 'project' AND canonical_name = ${canonicalize(project)} LIMIT 1
  `) as unknown as Row[];
  return rows[0] ? (rows[0].id as string) : null;
}

export async function findProjectBySlug(slug: string): Promise<ProjectRef | null> {
  const rows = (await getSql()`SELECT id, name, slug, visibility, owner_email, parent_id FROM entities WHERE type = 'project' AND slug = ${slug} LIMIT 1`) as unknown as Row[];
  return toRef(rows[0]);
}

export async function findProjectByName(name: string): Promise<ProjectRef | null> {
  const rows = (await getSql()`SELECT id, name, slug, visibility, owner_email, parent_id FROM entities WHERE type = 'project' AND name = ${name} LIMIT 1`) as unknown as Row[];
  return toRef(rows[0]);
}

export async function getEntryProject(entryId: string): Promise<ProjectRef | null> {
  const rows = (await getSql()`
    SELECT p.id, p.name, p.slug, p.visibility, p.owner_email, p.parent_id
    FROM context_entries ce JOIN entities p ON p.id = ce.project_id
    WHERE ce.id = ${entryId} LIMIT 1
  `) as unknown as Row[];
  return toRef(rows[0]);
}

/** Crea (o recupera) un proyecto. Público por defecto; `private` lo restringe; `parentSlug`
 * lo cuelga de un padre (cliente) → hereda contexto y permisos. */
export async function createProject(
  name: string,
  opts?: { visibility?: "public" | "private"; ownerEmail?: string | null; parentSlug?: string | null },
): Promise<ProjectRef> {
  const sql = getSql();
  let parentId: string | null = null;
  if (opts?.parentSlug) {
    const parent = await findProjectBySlug(opts.parentSlug);
    if (!parent) throw new Error(`Proyecto padre "${opts.parentSlug}" no encontrado.`);
    parentId = parent.id;
  }
  const slug = slugify(name);
  // El slug es la IDENTIDAD: si ya existe, NO inventamos un slug-2 — devolvemos el
  // existente para que el caller decida (acceso/solicitar permiso). Ver link.ts.
  const bySlug = await findProjectBySlug(slug);
  if (bySlug) return bySlug;
  const ent = await resolveEntity(sql, name, "project");
  const cur = (await sql`SELECT slug, visibility, owner_email, parent_id FROM entities WHERE id = ${ent.id}`) as unknown as Row[];
  if (cur[0]?.slug) return toRef({ ...cur[0], id: ent.id, name: ent.name })!; // ya existía (por nombre)
  const visibility = opts?.visibility ?? "public";
  await sql`UPDATE entities SET slug = ${slug}, visibility = ${visibility}, owner_email = ${opts?.ownerEmail ?? null}, parent_id = ${parentId} WHERE id = ${ent.id}`;
  return { id: ent.id, name: ent.name, slug, visibility, ownerEmail: opts?.ownerEmail ?? null, parentId };
}

export async function isProjectMember(projectId: string, email: string): Promise<boolean> {
  const r = (await getSql()`SELECT 1 FROM project_members WHERE project_id = ${projectId} AND email = ${email.toLowerCase()} LIMIT 1`) as unknown as unknown[];
  return r.length > 0;
}

/**
 * ¿Puede `email` acceder al proyecto? Cascada por la jerarquía: si el proyecto O algún
 * ANCESTRO es privado → restringido; concede acceso ser admin, o dueño/miembro del
 * proyecto o de cualquier ancestro (membresía del padre "Boluda" abre los subproyectos).
 */
export async function canAccessProject(project: ProjectRef, email: string | null): Promise<boolean> {
  const chain = (await getSql()`
    WITH RECURSIVE c AS (
      SELECT id, visibility, owner_email, parent_id FROM entities WHERE id = ${project.id}
      UNION ALL
      SELECT e.id, e.visibility, e.owner_email, e.parent_id FROM entities e JOIN c ON e.id = c.parent_id
    )
    SELECT id, visibility, owner_email FROM c
  `) as unknown as Row[];
  if (!chain.some((r) => (r.visibility as string) === "private")) return true; // todo público
  if (!email) return false;
  if (isAdmin(email)) return true;
  const e = email.toLowerCase();
  for (const r of chain) {
    if (((r.owner_email as string) ?? "").toLowerCase() === e) return true;
    if (await isProjectMember(r.id as string, e)) return true;
  }
  return false;
}

/** Resultado del guard único de acceso a proyecto. */
export type AccessCheck =
  | { status: "ok"; project: ProjectRef }
  | { status: "not_found" }
  | { status: "forbidden" };

/**
 * Política ÚNICA de acceso a proyecto para las apps (MCP, API, web). Resuelve el
 * proyecto por `slug` (si viene) o por `name` y aplica `canAccessProject`:
 * - proyecto inexistente → `not_found` (los callers de ESCRITURA por nombre pueden
 *   tratarlo como «se creará», porque el save auto-crea el proyecto; ver ADR),
 * - existente sin permiso → `forbidden`,
 * - existente con permiso → `ok` + el ProjectRef resuelto.
 * Sin `name` ni `slug` es un bug del caller → Error.
 */
export async function checkProjectAccess(
  email: string | null,
  ref: { name?: string; slug?: string },
): Promise<AccessCheck> {
  if (!ref.slug && !ref.name) throw new Error("checkProjectAccess: se necesita 'name' o 'slug' (bug del caller).");
  const project = ref.slug ? await findProjectBySlug(ref.slug) : await findProjectByName(ref.name!);
  if (!project) return { status: "not_found" };
  if (!(await canAccessProject(project, email))) return { status: "forbidden" };
  return { status: "ok", project };
}

/**
 * Acceso vía ID de entrada (validar, relacionar…): el permiso lo manda el proyecto de
 * la entrada.
 * - entrada inexistente → `not_found`,
 * - entrada sin proyecto → `ok` con `project: null` (no hay permisos que aplicar),
 * - proyecto de la entrada sin permiso → `forbidden`.
 */
export async function checkEntryAccess(
  email: string | null,
  entryId: string,
): Promise<{ status: "ok"; project: ProjectRef | null } | { status: "not_found" } | { status: "forbidden" }> {
  const rows = (await getSql()`
    SELECT p.id, p.name, p.slug, p.visibility, p.owner_email, p.parent_id
    FROM context_entries ce LEFT JOIN entities p ON p.id = ce.project_id
    WHERE ce.id = ${entryId} LIMIT 1
  `) as unknown as Row[];
  if (rows.length === 0) return { status: "not_found" };
  const project = rows[0]!.id ? toRef(rows[0]) : null;
  if (project && !(await canAccessProject(project, email))) return { status: "forbidden" };
  return { status: "ok", project };
}

/** Proyecto accesible con su nº de entradas (para los listados/selectores de la UI). */
export interface AccessibleProject extends ProjectRef {
  entryCount: number;
}

/**
 * Proyectos visibles para `email`: admin → todos; resto → públicos + privados
 * propios/compartidos. Incluye `entryCount` con UNA sola query agregada
 * (GROUP BY project_id) fusionada por id — no una query por proyecto.
 */
export async function listAccessibleProjects(email: string | null): Promise<AccessibleProject[]> {
  const sql = getSql();
  const rows = (await sql`SELECT id, name, slug, visibility, owner_email, parent_id FROM entities WHERE type = 'project' ORDER BY name`) as unknown as Row[];
  const countRows = (await sql`SELECT project_id, count(*)::int AS entry_count FROM context_entries WHERE project_id IS NOT NULL GROUP BY project_id`) as unknown as Row[];
  const counts = new Map(countRows.map((r) => [r.project_id as string, Number(r.entry_count)]));
  const refs = rows
    .map(toRef)
    .filter((r): r is ProjectRef => r !== null)
    .map((r): AccessibleProject => ({ ...r, entryCount: counts.get(r.id) ?? 0 }));
  if (isAdmin(email)) return refs;
  const out: AccessibleProject[] = [];
  for (const r of refs) if (await canAccessProject(r, email)) out.push(r);
  return out;
}

/** Añade un miembro a un proyecto privado (operación de admin). */
export async function addProjectMember(slug: string, email: string): Promise<void> {
  const p = await findProjectBySlug(slug);
  if (!p) throw new Error(`Proyecto "${slug}" no encontrado.`);
  await getSql()`INSERT INTO project_members (project_id, email) VALUES (${p.id}, ${email.toLowerCase()}) ON CONFLICT DO NOTHING`;
}

/** Quita un miembro de un proyecto (operación de admin). */
export async function removeProjectMember(slug: string, email: string): Promise<void> {
  const p = await findProjectBySlug(slug);
  if (!p) throw new Error(`Proyecto "${slug}" no encontrado.`);
  await getSql()`DELETE FROM project_members WHERE project_id = ${p.id} AND email = ${email.toLowerCase()}`;
}

/** Miembros (emails) de un proyecto. */
export async function listProjectMembers(slug: string): Promise<string[]> {
  const p = await findProjectBySlug(slug);
  if (!p) return [];
  const rows = (await getSql()`SELECT email FROM project_members WHERE project_id = ${p.id} ORDER BY email`) as unknown as Row[];
  return rows.map((r) => r.email as string);
}

/**
 * Resuelve el proyecto VINCULADO a un directorio (lee `.cortex.json`). NO crea: si el
 * slug no existe en Cortex (o hay opt-out / no hay `.cortex.json`), devuelve null.
 */
export async function resolveLinkedProject(cwd: string): Promise<ProjectRef | null> {
  const link = readCortexLink(cwd);
  if (!link || link.ignore === true) return null;
  if (link.slug) return findProjectBySlug(link.slug);
  if (link.project) return findProjectByName(link.project);
  return null;
}

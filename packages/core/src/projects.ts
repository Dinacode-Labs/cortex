import { getSql } from "@cortex/database";
import { resolveEntity } from "./entities.js";
import { isAdmin } from "./auth.js";
import { readCortexLink, slugify } from "./project-config.js";
import type { Row } from "./map.js";

/** Referencia a un proyecto (entidad type='project') con visibilidad y dueño. */
export interface ProjectRef {
  id: string;
  name: string;
  slug: string | null;
  visibility: "public" | "private";
  ownerEmail: string | null;
}

function toRef(r: Row | undefined): ProjectRef | null {
  if (!r) return null;
  return {
    id: r.id as string,
    name: r.name as string,
    slug: (r.slug as string) ?? null,
    visibility: ((r.visibility as string) ?? "public") === "private" ? "private" : "public",
    ownerEmail: (r.owner_email as string) ?? null,
  };
}

export async function findProjectBySlug(slug: string): Promise<ProjectRef | null> {
  const rows = (await getSql()`SELECT id, name, slug, visibility, owner_email FROM entities WHERE type = 'project' AND slug = ${slug} LIMIT 1`) as unknown as Row[];
  return toRef(rows[0]);
}

export async function findProjectByName(name: string): Promise<ProjectRef | null> {
  const rows = (await getSql()`SELECT id, name, slug, visibility, owner_email FROM entities WHERE type = 'project' AND name = ${name} LIMIT 1`) as unknown as Row[];
  return toRef(rows[0]);
}

/** Crea (o recupera) un proyecto. Por defecto PÚBLICO; `visibility:'private'` lo restringe. */
export async function createProject(name: string, opts?: { visibility?: "public" | "private"; ownerEmail?: string | null }): Promise<ProjectRef> {
  const sql = getSql();
  const ent = await resolveEntity(sql, name, "project");
  const cur = (await sql`SELECT slug, visibility, owner_email FROM entities WHERE id = ${ent.id}`) as unknown as Row[];
  if (cur[0]?.slug) return toRef({ ...cur[0], id: ent.id, name: ent.name })!; // ya existía
  let slug = slugify(name);
  for (let n = 2; await findProjectBySlug(slug); n++) slug = `${slugify(name)}-${n}`;
  const visibility = opts?.visibility ?? "public";
  await sql`UPDATE entities SET slug = ${slug}, visibility = ${visibility}, owner_email = ${opts?.ownerEmail ?? null} WHERE id = ${ent.id}`;
  return { id: ent.id, name: ent.name, slug, visibility, ownerEmail: opts?.ownerEmail ?? null };
}

export async function isProjectMember(projectId: string, email: string): Promise<boolean> {
  const r = (await getSql()`SELECT 1 FROM project_members WHERE project_id = ${projectId} AND email = ${email.toLowerCase()} LIMIT 1`) as unknown as unknown[];
  return r.length > 0;
}

/** ¿Puede `email` acceder al proyecto? Público → cualquiera; privado → dueño, miembro o admin. */
export async function canAccessProject(project: ProjectRef, email: string | null): Promise<boolean> {
  if (project.visibility !== "private") return true;
  if (!email) return false;
  if (isAdmin(email)) return true;
  if (project.ownerEmail && project.ownerEmail.toLowerCase() === email.toLowerCase()) return true;
  return isProjectMember(project.id, email);
}

/** Proyectos visibles para `email`: admin → todos; resto → públicos + privados propios/compartidos. */
export async function listAccessibleProjects(email: string | null): Promise<ProjectRef[]> {
  const rows = (await getSql()`SELECT id, name, slug, visibility, owner_email FROM entities WHERE type = 'project' ORDER BY name`) as unknown as Row[];
  const refs = rows.map(toRef).filter((r): r is ProjectRef => r !== null);
  if (isAdmin(email)) return refs;
  const out: ProjectRef[] = [];
  for (const r of refs) if (await canAccessProject(r, email)) out.push(r);
  return out;
}

/** Añade un miembro a un proyecto privado (operación de admin). */
export async function addProjectMember(slug: string, email: string): Promise<void> {
  const p = await findProjectBySlug(slug);
  if (!p) throw new Error(`Proyecto "${slug}" no encontrado.`);
  await getSql()`INSERT INTO project_members (project_id, email) VALUES (${p.id}, ${email.toLowerCase()}) ON CONFLICT DO NOTHING`;
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

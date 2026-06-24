import { getSql } from "@cortex/database";
import { resolveEntity } from "./entities.js";
import { readCortexLink, slugify } from "./project-config.js";
import type { Row } from "./map.js";

/** Referencia mínima a un proyecto (entidad type='project'). */
export interface ProjectRef {
  id: string;
  name: string;
  slug: string | null;
}

function toRef(r: Row | undefined): ProjectRef | null {
  return r ? { id: r.id as string, name: r.name as string, slug: (r.slug as string) ?? null } : null;
}

/** Busca un proyecto por slug. NO crea. */
export async function findProjectBySlug(slug: string): Promise<ProjectRef | null> {
  const rows = (await getSql()`SELECT id, name, slug FROM entities WHERE type = 'project' AND slug = ${slug} LIMIT 1`) as unknown as Row[];
  return toRef(rows[0]);
}

/** Busca un proyecto por nombre (back-compat de `.cortex.json` legacy). NO crea. */
export async function findProjectByName(name: string): Promise<ProjectRef | null> {
  const rows = (await getSql()`SELECT id, name, slug FROM entities WHERE type = 'project' AND name = ${name} LIMIT 1`) as unknown as Row[];
  return toRef(rows[0]);
}

/** Crea (o recupera) un proyecto y le asigna un slug único si no lo tenía. */
export async function createProject(name: string, slugWanted?: string): Promise<ProjectRef> {
  const sql = getSql();
  const ent = await resolveEntity(sql, name, "project"); // idempotente por nombre canónico
  const cur = (await sql`SELECT slug FROM entities WHERE id = ${ent.id}`) as unknown as Row[];
  const existing = cur[0]?.slug as string | null;
  if (existing) return { id: ent.id, name: ent.name, slug: existing };
  let slug = slugify(slugWanted || name);
  for (let n = 2; await findProjectBySlug(slug); n++) slug = `${slugify(slugWanted || name)}-${n}`;
  await sql`UPDATE entities SET slug = ${slug} WHERE id = ${ent.id}`;
  return { id: ent.id, name: ent.name, slug };
}

/**
 * Resuelve el proyecto VINCULADO a un directorio (lee `.cortex.json`). NO crea: si el
 * slug no corresponde a un proyecto existente en Cortex, devuelve null (gate: hay que
 * crear/vincular antes de que fluya nada). Respeta el opt-out `{ "ignore": true }`.
 */
export async function resolveLinkedProject(cwd: string): Promise<ProjectRef | null> {
  const link = readCortexLink(cwd);
  if (!link || link.ignore === true) return null;
  if (link.slug) return findProjectBySlug(link.slug);
  if (link.project) return findProjectByName(link.project); // legacy (por nombre, sin crear)
  return null;
}

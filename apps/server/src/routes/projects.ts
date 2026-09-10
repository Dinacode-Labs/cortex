import { Hono } from "hono";
import {
  canAccessProject,
  createProject,
  findProjectBySlug,
  listAccessibleProjects,
  listAdmins,
  slugify,
  type ProjectRef,
} from "@cortex/core";
import { createProjectRequest, type ProjectSummary } from "@cortex/shared";
import { currentUser } from "../auth-helpers.js";
import { parseBody } from "../validate.js";

/**
 * Proyectos por HTTP. Existe para que `cortex link` deje de hablar directamente con
 * Postgres: es el último comando del CLI que necesitaba la base de datos, y mientras la
 * necesite no se puede distribuir un cliente ligero (ADR-0025).
 */
export const projectRoutes = new Hono();

const toSummary = (p: ProjectRef): ProjectSummary => ({
  slug: p.slug!,
  name: p.name,
  visibility: p.visibility ?? "public",
});

/** Proyectos visibles para el usuario (admin → todos). */
projectRoutes.get("/projects", async (c) => {
  const user = await currentUser(c);
  if (!user) return c.json({ error: "Not authenticated." }, 401);
  const projects = await listAccessibleProjects(user.email);
  return c.json({ projects: projects.map(toSummary) });
});

/**
 * Un proyecto por slug. Distingue 404 de 403 a propósito: saber que un proyecto existe
 * pero es privado es justo lo que necesita el CLI para decirte a quién pedir acceso, y no
 * es información sensible (el slug ya lo escribiste tú).
 */
projectRoutes.get("/projects/:slug", async (c) => {
  const user = await currentUser(c);
  if (!user) return c.json({ error: "Not authenticated." }, 401);
  const project = await findProjectBySlug(c.req.param("slug"));
  if (!project) return c.json({ error: "Project not found." }, 404);
  if (!(await canAccessProject(project, user.email))) {
    return c.json({ error: "This project is private. Ask an administrator for access.", admins: listAdmins() }, 403);
  }
  return c.json({ project: toSummary(project) });
});

/**
 * Crea un proyecto, o devuelve el que ya existe con ese slug.
 *
 * El slug es la IDENTIDAD: si ya está cogido no se inventa un `-2`, porque eso acaba
 * partiendo en dos la memoria del mismo proyecto. Se responde `created: false` si el
 * usuario tiene acceso, o 403 con la lista de admins si es privado y ajeno.
 */
projectRoutes.post("/projects", async (c) => {
  const user = await currentUser(c);
  if (!user) return c.json({ error: "Not authenticated." }, 401);
  const body = await parseBody(c, createProjectRequest);
  if (body instanceof Response) return body;

  const existing = await findProjectBySlug(slugify(body.name));
  if (existing) {
    if (!(await canAccessProject(existing, user.email))) {
      return c.json(
        { error: `Ya existe un proyecto "${existing.name}" y es privado: pide acceso.`, admins: listAdmins() },
        403,
      );
    }
    return c.json({ project: toSummary(existing), created: false });
  }

  try {
    const project = await createProject(body.name, {
      visibility: body.visibility ?? "public",
      ownerEmail: user.email,
      parentSlug: body.parentSlug ?? null,
    });
    return c.json({ project: toSummary(project), created: true }, 201);
  } catch (e) {
    // El caso realista es un `parentSlug` que no existe: es culpa del cliente, no del
    // servidor, así que 400 con el motivo en vez de un 500 opaco.
    return c.json({ error: (e as Error).message }, 400);
  }
});

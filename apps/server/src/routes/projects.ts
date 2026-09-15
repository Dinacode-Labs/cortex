import { Hono } from "hono";
import {
  addProjectMember,
  canAccessProject,
  canManageProject,
  createProject,
  findProjectBySlug,
  listAccessibleProjects,
  listAdmins,
  listProjectMembers,
  NotAManagerError,
  removeProjectMember,
  slugify,
  updateProject,
  type ProjectRef,
} from "@cortex/core";
import { createProjectRequest, projectMemberRequest, updateProjectRequest, type ProjectSummary } from "@cortex/shared";
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

/**
 * Cambia la visibilidad o el dueño de un proyecto (ADR-0051).
 *
 * El agujero que tapa: hasta ahora la visibilidad se fijaba al crear y no había forma de
 * cambiarla en ninguna interfaz, así que un proyecto nacido público lo era para siempre.
 * Quien puede hacerlo lo decide el dominio (`canManageProject`): el dueño o un admin.
 */
projectRoutes.patch("/projects/:slug", async (c) => {
  const user = await currentUser(c);
  if (!user) return c.json({ error: "Not authenticated." }, 401);
  const body = await parseBody(c, updateProjectRequest);
  if (body instanceof Response) return body;
  const slug = c.req.param("slug");
  // Un proyecto que no puedes ni ver responde 404, no 403: lo contrario diría que existe.
  const project = await findProjectBySlug(slug);
  if (!project || !(await canAccessProject(project, user.email))) return c.json({ error: "Project not found." }, 404);
  try {
    return c.json({ project: toSummary(await updateProject(slug, body, user.email)) });
  } catch (e) {
    if (e instanceof NotAManagerError) return c.json({ error: e.message }, 403);
    return c.json({ error: (e as Error).message }, 400);
  }
});

/** Miembros de un proyecto. Ver la lista exige poder gestionarlo: es quién tiene acceso. */
projectRoutes.get("/projects/:slug/members", async (c) => {
  const user = await currentUser(c);
  if (!user) return c.json({ error: "Not authenticated." }, 401);
  const slug = c.req.param("slug");
  const project = await findProjectBySlug(slug);
  if (!project || !(await canAccessProject(project, user.email))) return c.json({ error: "Project not found." }, 404);
  if (!(await canManageProject(user.email, slug))) return c.json({ error: new NotAManagerError(slug).message }, 403);
  return c.json({ members: await listProjectMembers(slug) });
});

projectRoutes.post("/projects/:slug/members", async (c) => {
  const user = await currentUser(c);
  if (!user) return c.json({ error: "Not authenticated." }, 401);
  const body = await parseBody(c, projectMemberRequest);
  if (body instanceof Response) return body;
  const slug = c.req.param("slug");
  const project = await findProjectBySlug(slug);
  if (!project || !(await canAccessProject(project, user.email))) return c.json({ error: "Project not found." }, 404);
  try {
    await addProjectMember(slug, body.email, user.email);
  } catch (e) {
    if (e instanceof NotAManagerError) return c.json({ error: e.message }, 403);
    throw e;
  }
  return c.json({ members: await listProjectMembers(slug) });
});

projectRoutes.delete("/projects/:slug/members", async (c) => {
  const user = await currentUser(c);
  if (!user) return c.json({ error: "Not authenticated." }, 401);
  const body = await parseBody(c, projectMemberRequest);
  if (body instanceof Response) return body;
  const slug = c.req.param("slug");
  const project = await findProjectBySlug(slug);
  if (!project || !(await canAccessProject(project, user.email))) return c.json({ error: "Project not found." }, 404);
  try {
    await removeProjectMember(slug, body.email, user.email);
  } catch (e) {
    if (e instanceof NotAManagerError) return c.json({ error: e.message }, 403);
    throw e;
  }
  return c.json({ members: await listProjectMembers(slug) });
});

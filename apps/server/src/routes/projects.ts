import { Hono } from "hono";
import {
  addProjectMember,
  canAccessProject,
  canManageProject,
  createProject,
  deleteProject,
  findProjectBySlug,
  listAccessibleProjects,
  listAdmins,
  listProjectMembers,
  NotAManagerError,
  ProjectNotEmptyError,
  removeProjectMember,
  slugify,
  updateProject,
  type ProjectRef,
} from "@cortex/core";
import { createProjectRequest, projectMemberRequest, updateProjectRequest, type ProjectSummary } from "@cortex/shared";
import { currentUser } from "../auth-helpers.js";
import { parseBody } from "../validate.js";

/**
 * Projects over HTTP. It exists so `cortex link` stops talking directly to Postgres: it was
 * the last CLI command that needed the database, and while it needed it no lightweight client
 * could be shipped (ADR-0025).
 */
export const projectRoutes = new Hono();

const toSummary = (p: ProjectRef): ProjectSummary => ({
  slug: p.slug!,
  name: p.name,
  visibility: p.visibility ?? "public",
});

/** Projects visible to the user (an admin sees them all). */
projectRoutes.get("/projects", async (c) => {
  const user = await currentUser(c);
  if (!user) return c.json({ error: "Not authenticated." }, 401);
  const projects = await listAccessibleProjects(user.email);
  return c.json({ projects: projects.map(toSummary) });
});

/**
 * One project by slug. It distinguishes 404 from 403 on purpose: knowing that a project exists
 * but is private is exactly what the CLI needs in order to tell you whom to ask for access,
 * and it is not sensitive (you typed the slug yourself).
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
 * Creates a project, or returns the one that already holds that slug.
 *
 * The slug is the IDENTITY: when it is taken, no `-2` is invented, because that ends up
 * splitting the same project's memory in two. The answer is `created: false` when the user has
 * access, or a 403 with the admin list when it is private and somebody else's.
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
        { error: `A project "${existing.name}" already exists and is private: ask for access.`, admins: listAdmins() },
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
    // The realistic case is a `parentSlug` that does not exist: that is the client's fault,
    // not the server's, so a 400 with the reason rather than an opaque 500.
    return c.json({ error: (e as Error).message }, 400);
  }
});

/**
 * Changes a project's visibility or owner (ADR-0051).
 *
 * The hole it closes: visibility used to be fixed at creation with no way to change it in any
 * interface, so a project born public stayed public forever. Who may do it is decided by the
 * domain (`canManageProject`): the owner or an admin.
 */
projectRoutes.patch("/projects/:slug", async (c) => {
  const user = await currentUser(c);
  if (!user) return c.json({ error: "Not authenticated." }, 401);
  const body = await parseBody(c, updateProjectRequest);
  if (body instanceof Response) return body;
  const slug = c.req.param("slug");
  // A project you cannot even see answers 404, not 403: the opposite would reveal it exists.
  const project = await findProjectBySlug(slug);
  if (!project || !(await canAccessProject(project, user.email))) return c.json({ error: "Project not found." }, 404);
  try {
    return c.json({ project: toSummary(await updateProject(slug, body, user.email)) });
  } catch (e) {
    if (e instanceof NotAManagerError) return c.json({ error: e.message }, 403);
    return c.json({ error: (e as Error).message }, 400);
  }
});

/** A project's members. Seeing the list requires being able to manage it: it is who has access. */
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

/**
 * Deletes an empty project: it undoes a mistaken `cortex link --create` and nothing else.
 *
 * With memory inside it answers 409 and touches nothing. A product whose principle is that
 * invalidating is not deleting cannot have "delete a client's whole memory" one click away
 * (ADR-0057).
 */
projectRoutes.delete("/projects/:slug", async (c) => {
  const user = await currentUser(c);
  if (!user) return c.json({ error: "Not authenticated." }, 401);
  const slug = c.req.param("slug");
  const project = await findProjectBySlug(slug);
  if (!project || !(await canAccessProject(project, user.email))) return c.json({ error: "Project not found." }, 404);
  try {
    await deleteProject(slug, user.email);
  } catch (e) {
    if (e instanceof NotAManagerError) return c.json({ error: e.message }, 403);
    if (e instanceof ProjectNotEmptyError) return c.json({ error: e.message }, 409);
    throw e;
  }
  return c.json({ deleted: slug });
});

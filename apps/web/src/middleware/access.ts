import type { Context } from "hono";
import { html } from "hono/html";
import {
  canManageProject,
  checkProjectAccess,
  findProjectBySlug,
  listAccessibleProjects,
  listProjectAncestors,
  type AccessibleProject,
  type ProjectRef,
  type AuthUser,
} from "@cortex/core";
import { layout, type Html } from "../views/layout.js";
import type { WebEnv } from "./session.js";

/** The access-denied page for a private project (403). */
export const deniedPage = (user: AuthUser | null): Html =>
  layout(
    "No access",
    html`<p><a class="back" href="/">← Projects</a></p>
      <div class="empty">You do not have access to this project. Ask its owner or an administrator to add you.</div>`,
    user,
  );

const notFound = (c: Context<WebEnv>) =>
  c.html(
    layout(
      "Not found",
      html`<p><a class="back" href="/">← Projects</a></p><div class="empty">Project not found.</div>`,
      c.get("user"),
    ),
    404,
  );

/** Access gate by project NAME (the single policy, `checkProjectAccess`). */
export async function requireProject(c: Context<WebEnv>, name: string | undefined | null): Promise<Response | null> {
  if (!name) return null;
  const access = await checkProjectAccess(c.get("user")?.email ?? null, { name });
  if (access.status === "not_found") return notFound(c);
  if (access.status === "forbidden") return c.html(deniedPage(c.get("user")), 403);
  return null;
}

export interface ProjectPage {
  project: AccessibleProject;
  /** Whether the viewer can change visibility, owner and members (ADR-0051). */
  manager: boolean;
  /** From the root to the direct parent, for the breadcrumb and for saying what inherits what. */
  ancestors: ProjectRef[];
  /**
   * The children THE VIEWER can see, not all of them: a private repo they are not a member of
   * does not appear just because they can see the parent. It comes from the same accessible
   * list already queried here, so it costs no extra query, and it decides whether this project
   * is a client -- the "Across this client" tab and the repo list only exist when it has some.
   */
  children: AccessibleProject[];
}

/**
 * Resolves the project behind a `/p/<slug>/...` URL while applying the policy, and along the
 * way says whether the viewer can manage it.
 *
 * It returns a `Response` when the request must be stopped (404 or 403) and the project when it
 * may continue. The slug is the project's address on the web (ADR-0050), so this gate runs in
 * every section and is the only place where the decision is made.
 */
export async function requireProjectPage(
  c: Context<WebEnv>,
  slug: string,
): Promise<ProjectPage | Response> {
  const email = c.get("user")?.email ?? null;
  const access = await checkProjectAccess(email, { slug });
  if (access.status === "not_found") return notFound(c);
  if (access.status === "forbidden") return c.html(deniedPage(c.get("user")), 403);
  // `listAccessibleProjects` brings the entry count from a single aggregate query; using that
  // list avoids an extra query just for the number in the header.
  const accessible = await listAccessibleProjects(email);
  const withCount = accessible.find((p) => p.slug === slug);
  const base = withCount ?? { ...(await findProjectBySlug(slug))!, entryCount: 0 };
  return {
    project: base,
    manager: await canManageProject(email, slug),
    ancestors: base.parentId ? await listProjectAncestors(base.id) : [],
    children: accessible.filter((p) => p.parentId === base.id),
  };
}

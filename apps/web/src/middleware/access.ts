import type { Context } from "hono";
import { html } from "hono/html";
import {
  canManageProject,
  checkProjectAccess,
  findProjectBySlug,
  listAccessibleProjects,
  type AccessibleProject,
  type AuthUser,
} from "@cortex/core";
import { layout, type Html } from "../views/layout.js";
import type { WebEnv } from "./session.js";

/** Página de denegación de acceso a un proyecto privado (403). */
export const deniedPage = (user: AuthUser | null): Html =>
  layout(
    "No access",
    html`<p><a class="back" href="/">← Projects</a></p>
      <div class="empty">You do not have access to this project. Ask its owner or an administrator to add you.</div>`,
    user,
  );

const noEncontrado = (c: Context<WebEnv>) =>
  c.html(
    layout(
      "Not found",
      html`<p><a class="back" href="/">← Projects</a></p><div class="empty">Project not found.</div>`,
      c.get("user"),
    ),
    404,
  );

/** Gate de acceso por NOMBRE de proyecto (política única, `checkProjectAccess`). */
export async function requireProject(c: Context<WebEnv>, name: string | undefined | null): Promise<Response | null> {
  if (!name) return null;
  const access = await checkProjectAccess(c.get("user")?.email ?? null, { name });
  if (access.status === "not_found") return noEncontrado(c);
  if (access.status === "forbidden") return c.html(deniedPage(c.get("user")), 403);
  return null;
}

export interface ProyectoDeLaPagina {
  project: AccessibleProject;
  /** Si quien mira puede cambiar visibilidad, dueño y miembros (ADR-0051). */
  gestor: boolean;
}

/**
 * Resuelve el proyecto de una URL `/p/<slug>/…` aplicando la política, y de paso dice si
 * quien mira puede gestionarlo.
 *
 * Devuelve `Response` cuando hay que cortar (404 o 403) y el proyecto cuando se puede seguir.
 * El slug pasa a ser la dirección del proyecto en la web (ADR-0050), así que este gate corre
 * en todas las secciones y es el único sitio donde se decide.
 */
export async function requireProjectPage(
  c: Context<WebEnv>,
  slug: string,
): Promise<ProyectoDeLaPagina | Response> {
  const email = c.get("user")?.email ?? null;
  const access = await checkProjectAccess(email, { slug });
  if (access.status === "not_found") return noEncontrado(c);
  if (access.status === "forbidden") return c.html(deniedPage(c.get("user")), 403);
  // `listAccessibleProjects` trae el recuento de entradas de una sola consulta agregada; usar
  // esa lista evita una query extra solo para el número de la cabecera.
  const conCuenta = (await listAccessibleProjects(email)).find((p) => p.slug === slug);
  const base = conCuenta ?? { ...(await findProjectBySlug(slug))!, entryCount: 0 };
  return { project: base, gestor: await canManageProject(email, slug) };
}

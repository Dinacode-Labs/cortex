import type { Context } from "hono";
import { html } from "hono/html";
import { checkProjectAccess, type AuthUser } from "@cortex/core";
import { layout, type Html } from "../views/layout.js";
import type { WebEnv } from "./session.js";

/** Página de denegación de acceso a un proyecto privado (403). */
export const deniedPage = (user: AuthUser | null): Html =>
  layout("Sin acceso", html`<p><a class="back" href="/">← Inicio</a></p><div class="empty">No tienes acceso a este proyecto (privado). Pide al admin que te añada.</div>`, user);

/** Gate de acceso por nombre de proyecto (política única, checkProjectAccess):
 *  `null` = puede continuar; `Response` = denegación ya renderizada. Proyecto
 *  inexistente → 404 (antes esta UI dejaba pasar); sin acceso → 403 deniedPage.
 *  Sin `name` no hay filtro de proyecto que aplicar → continúa. */
export async function requireProject(c: Context<WebEnv>, name: string | undefined | null): Promise<Response | null> {
  if (!name) return null;
  const access = await checkProjectAccess(c.get("user")?.email ?? null, { name });
  if (access.status === "not_found")
    return c.html(layout("No encontrado", html`<p><a class="back" href="/">← Inicio</a></p><div class="empty">Proyecto no encontrado.</div>`, c.get("user")), 404);
  if (access.status === "forbidden") return c.html(deniedPage(c.get("user")), 403);
  return null;
}

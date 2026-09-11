import type { MiddlewareHandler } from "hono";
import { getCookie } from "hono/cookie";
import { html } from "hono/html";
import { validateToken, type AuthUser } from "@cortex/core";
import { getBrandName } from "@cortex/shared";
import { layout, type Html } from "../views/layout.js";

/** Entorno de la app web: el usuario de la sesión (o null) en `c.var.user`. */
export type WebEnv = { Variables: { user: AuthUser | null } };

/** Página de login: la respuesta del gate sin sesión (y de /auth/cli y /logout). */
export function loginPage(msg = ""): Html {
  return layout(
    "Sign in",
    html`<div class="empty" style="max-width:560px;margin:48px auto;text-align:center">
       <h1>${getBrandName()}</h1>
       <p>You need to sign in to see the project memory.</p>
       ${msg ? html`<p style="color:#c0392b">${msg}</p>` : ""}
       <p style="margin-top:16px">From your terminal:</p>
       <pre style="text-align:left;display:inline-block">cortex auth login   # once per machine
cortex ui           # opens this UI, already signed in</pre>
     </div>`,
  );
}

/**
 * Gate de sesión: resuelve el usuario desde la cookie → `c.var.user`; sin sesión
 * válida → 401 con la página de login. Las rutas EXENTAS (/auth/cli, /logout) y los
 * estáticos se montan ANTES de este middleware en app.ts — el orden de registro es
 * la exención.
 */
export const sessionGate: MiddlewareHandler<WebEnv> = async (c, next) => {
  const token = getCookie(c, "cortex_session");
  const user = token ? await validateToken(token) : null;
  c.set("user", user);
  if (!user) return c.html(loginPage(), 401);
  await next();
};

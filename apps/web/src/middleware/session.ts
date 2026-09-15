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
  // No hay formulario a propósito: se entra desde la terminal, y el token de larga vida del
  // CLI nunca viaja por una URL (ADR-0025). Así que esta pantalla solo tiene un trabajo,
  // que es decir exactamente qué teclear.
  return layout(
    "Sign in",
    html`<div class="signin stack">
      <h1>${getBrandName()}</h1>
      <p class="sub">Project memory for your coding agents. Sign in from your terminal:</p>
      ${msg ? html`<div class="warn contradiction">${msg}</div>` : ""}
      <pre class="content-block">cortex auth login   # once per machine
cortex ui           # opens this UI, already signed in</pre>
      <p class="sub">No CLI yet? <code>npm install -g @dinacodelabs/cortex</code></p>
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

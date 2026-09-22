import type { MiddlewareHandler } from "hono";
import { getCookie } from "hono/cookie";
import { html } from "hono/html";
import { validateToken, type AuthUser } from "@cortex/core";
import { getBrandName } from "@cortex/shared";
import { layout, type Html } from "../views/layout.js";

export type WebEnv = { Variables: { user: AuthUser | null } };

export function loginPage(msg = ""): Html {
  // There is no form on purpose: you sign in from the terminal, and the CLI's long-lived token
  // never travels through a URL (ADR-0025). So this screen has exactly one job, which is to
  // say precisely what to type.
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
 * The EXEMPT routes (/auth/cli, /logout) and the statics are mounted BEFORE this middleware in
 * app.ts -- registration order is the exemption.
 */
export const sessionGate: MiddlewareHandler<WebEnv> = async (c, next) => {
  const token = getCookie(c, "cortex_session");
  const user = token ? await validateToken(token) : null;
  c.set("user", user);
  if (!user) return c.html(loginPage(), 401);
  await next();
};

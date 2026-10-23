import { Hono } from "hono";
import { html } from "hono/html";
import { unsubscribeLink, unsubscribeWithToken } from "@cortex/core";
import { layout } from "../views/layout.js";
import { panel } from "../views/components.js";
import type { WebEnv } from "../middleware/session.js";

// Exempt from the session gate: signing in happens in the terminal, not in the browser that
// opens the email. Only the POST acts, because mail scanners open every link (ADR-0097).
export const unsubscribeRoutes = new Hono<WebEnv>();

const expired = () =>
  layout(
    "Link expired",
    panel(
      "This link has expired",
      html`<p class="sub">Unsubscribe links last 30 days. Every digest brings a fresh one, and you can always turn it off in the project's Settings: run <code>cortex ui</code> and open the project.</p>`,
    ),
  );

unsubscribeRoutes.get("/unsubscribe/:token", async (c) => {
  const link = await unsubscribeLink(c.req.param("token"));
  if (!link) return c.html(expired(), 404);
  return c.html(
    layout(
      "Review digest",
      panel(
        `Stop the review digest for ${link.project.name}?`,
        html`<form class="row" method="post" action="/unsubscribe/${c.req.param("token")}">
          <button type="submit">Turn it off</button>
        </form>`,
        { help: html`The daily email about memos waiting in its Review, sent to <b>${link.email}</b>. Your other projects keep theirs.` },
      ),
    ),
  );
});

unsubscribeRoutes.post("/unsubscribe/:token", async (c) => {
  const link = await unsubscribeWithToken(c.req.param("token"));
  if (!link) return c.html(expired(), 404);
  return c.html(
    layout(
      "Review digest",
      panel(
        `The review digest is off for ${link.project.name}`,
        html`<p class="sub"><b>${link.email}</b> will not get it for this project any more. To turn it back on, run <code>cortex ui</code> and open the project's Settings.</p>`,
      ),
    ),
  );
});

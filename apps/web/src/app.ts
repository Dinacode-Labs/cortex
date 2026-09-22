import { resolve } from "node:path";
import { Hono } from "hono";
import { secureHeaders } from "hono/secure-headers";
import { pingDatabase } from "@cortex/database";
import { html } from "hono/html";
import { serveStatic } from "@hono/node-server/serve-static";
import { getBrandLogoSvg, markSvg } from "@cortex/shared";
import { sessionGate, type WebEnv } from "./middleware/session.js";
import { layout } from "./views/layout.js";
import { authRoutes } from "./routes/auth.js";
import { projectsRoutes } from "./routes/projects.js";
import { projectRoutes } from "./routes/project.js";
import { searchRoutes } from "./routes/search.js";
import { entriesRoutes } from "./routes/entries.js";
import { usageRoutes } from "./routes/usage.js";
import { graphRoutes } from "./routes/graph.js";
import { redirectRoutes } from "./routes/redirects.js";

/**
 * A minimal demo UI (section 16). Server-rendered (Hono), with no frontend build. It is a
 * second consumer of @cortex/core, showing that humans and agents share the same context layer
 * (section 5.4).
 *
 * This module has NO import-time effects (neither loadEnv nor serve): `createApp()` only
 * COMPOSES the app -- statics + exempt routes + the session gate + the routes (`routes/`, one
 * per resource) -- and the thin entrypoint (`index.ts`) starts it. That way the tests exercise
 * the routes with `app.request()` without standing up a server.
 */
export type { WebEnv } from "./middleware/session.js";

// ABSOLUTE root for the statics: it works whether started from the monorepo root or from
// apps/web (it does not depend on the process's cwd).
const PUBLIC_DIR = resolve(import.meta.dirname, "../public");

export function createApp(): Hono<WebEnv> {
  const app = new Hono<WebEnv>();
  app.use("*", secureHeaders());

  // Before the session gate, or the container's healthcheck would get a redirect to login.
  app.get("/health", async (c) => {
    const db = await pingDatabase();
    return c.json({ ok: db, service: "cortex-web", db: db ? "ok" : "down" }, db ? 200 : 503);
  });

  // Favicon: the operator's logo if there is one, otherwise the Cortex mark. At 16 px each cell
  // is 2 px and a 0.5 stroke is exactly 1 px. On a dark tab the pieces go solid and light: hollow
  // ones would not show.
  app.get("/favicon.svg", (c) => {
    const svg =
      getBrandLogoSvg() ??
      markSvg({
        ink: "#5b6673",
        accent: "#1a6dff",
        hollow: { fill: "#ffffff", strokeWidth: 0.5 },
        style: "@media (prefers-color-scheme:dark){path{fill:#f2f5f8;stroke:#f2f5f8}}",
      });
    return c.body(svg, 200, { "Content-Type": "image/svg+xml", "Cache-Control": "public, max-age=86400" });
  });

  // Statics (styles.css, graph.js): reachable WITHOUT a session -- the login page itself links
  // /styles.css. When the file does not exist, serveStatic calls next().
  app.use("*", serveStatic({ root: PUBLIC_DIR }));

  // Routes exempt from the gate (the CLI handshake and logout): mounted BEFORE the gate --
  // registration order is the exemption.
  app.route("/", authRoutes);

  // The gate: every other route requires a session (it resolves c.var.user from the cookie).
  app.use("*", sessionGate);

  // Redirects go FIRST: an old path must not fall into a new one's 404.
  app.route("/", redirectRoutes);
  app.route("/", projectsRoutes);
  app.route("/", projectRoutes);
  app.route("/", searchRoutes);
  app.route("/", entriesRoutes);
  app.route("/", usageRoutes);
  app.route("/", graphRoutes);

  // Unhandled errors: a full log on the server plus a generic page (500), leaking no internal
  // detail to the browser.
  app.onError((err, c) => {
    console.error("[cortex-web] unhandled error:", err);
    return c.html(
      layout("Error", html`<p><a class="back" href="/">← Projects</a></p><div class="empty">Something went wrong. Try again.</div>`, c.get("user") ?? null),
      500,
    );
  });

  return app;
}

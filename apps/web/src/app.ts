import { resolve } from "node:path";
import { Hono } from "hono";
import { secureHeaders } from "hono/secure-headers";
import { pingDatabase } from "@cortex/database";
import { html } from "hono/html";
import { serveStatic } from "@hono/node-server/serve-static";
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
 * UI mínima de demo (§16). Renderizado en servidor (Hono), sin build de
 * frontend. Es un segundo consumidor de @cortex/core, demostrando que humanos y
 * agentes comparten la misma capa de contexto (§5.4).
 *
 * Este módulo NO tiene efectos al importar (ni loadEnv ni serve): `createApp()`
 * solo COMPONE la app — estáticos + rutas exentas + gate de sesión + rutas
 * (`routes/`, una por recurso) — y el entrypoint fino (`index.ts`) la arranca.
 * Así los tests ejercitan las rutas con `app.request()` sin levantar un servidor.
 */
export type { WebEnv } from "./middleware/session.js";

// Root ABSOLUTO de los estáticos: funciona arrancando desde la raíz del monorepo
// o desde apps/web (no depende del cwd del proceso).
const PUBLIC_DIR = resolve(import.meta.dirname, "../public");

/** Construye la app web completa (estáticos + middleware de sesión + rutas). Sin side effects. */
export function createApp(): Hono<WebEnv> {
  const app = new Hono<WebEnv>();
  app.use("*", secureHeaders());

  // Antes del gate de sesión, o el healthcheck del contenedor recibiría un redirect a login.
  app.get("/health", async (c) => {
    const db = await pingDatabase();
    return c.json({ ok: db, service: "cortex-web", db: db ? "ok" : "down" }, db ? 200 : 503);
  });

  // Estáticos (styles.css, graph.js): accesibles SIN sesión — la propia página de
  // login enlaza /styles.css. Si el fichero no existe, serveStatic hace next().
  app.use("*", serveStatic({ root: PUBLIC_DIR }));

  // Rutas exentas del gate (handshake CLI y logout): montadas ANTES del gate,
  // el orden de registro es la exención.
  app.route("/", authRoutes);

  // Gate: el resto de rutas requieren sesión (resuelve c.var.user desde la cookie).
  app.use("*", sessionGate);

  // Las redirecciones van PRIMERO: una ruta vieja no debe caer en el 404 de una nueva.
  app.route("/", redirectRoutes);
  app.route("/", projectsRoutes);
  app.route("/", projectRoutes);
  app.route("/", searchRoutes);
  app.route("/", entriesRoutes);
  app.route("/", usageRoutes);
  app.route("/", graphRoutes);

  // Errores no controlados: log completo en servidor + página genérica (500),
  // sin filtrar detalles internos al navegador.
  app.onError((err, c) => {
    console.error("[cortex-web] error no controlado:", err);
    return c.html(
      layout("Error", html`<p><a class="back" href="/">← Projects</a></p><div class="empty">Something went wrong. Try again.</div>`, c.get("user") ?? null),
      500,
    );
  });

  return app;
}

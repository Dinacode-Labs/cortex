import { Hono } from "hono";
import { authRoutes } from "./routes/auth.js";
import { contextRoutes } from "./routes/context.js";
import { installRoutes } from "./routes/install.js";

/**
 * API HTTP de Cortex (Hono). Autenticación email + OTP + endpoints autenticados de
 * contexto (los hooks/conectores los usan en vez de tocar la BD directamente): la
 * escritura se atribuye al usuario (created_by = email) y respeta permisos. Ver
 * docs/decisions.md.
 *
 * Este módulo NO tiene efectos al importar (ni loadEnv ni serve): `createApp()`
 * solo COMPONE la app — health + routers (`routes/`, uno por recurso) + onError —
 * y el entrypoint fino (`index.ts`) la arranca. Así los tests pueden ejercitar
 * las rutas con `app.request()` sin levantar un servidor.
 */

/** Construye la API HTTP completa (auth + contexto). Sin side effects. */
export function createApp(): Hono {
  const app = new Hono();

  app.get("/health", (c) => c.json({ ok: true, service: "cortex-server" }));

  app.route("/", installRoutes);
  app.route("/", authRoutes);
  app.route("/", contextRoutes);

  // Errores no controlados: log completo en servidor + 500 JSON genérico,
  // sin filtrar detalles internos al cliente.
  app.onError((err, c) => {
    console.error("[cortex-server] error no controlado:", err);
    return c.json({ error: "Error interno." }, 500);
  });

  return app;
}

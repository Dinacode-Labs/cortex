import { Hono } from "hono";
import { secureHeaders } from "hono/secure-headers";
import { pingDatabase } from "@cortex/database";
import { getEnvNum } from "@cortex/shared";
import { distillSession, type DistillSessionFn } from "@cortex/agents";
import { createCaptureQueue } from "./capture-queue.js";
import { captureSessionRoutes, makeCaptureRunner, type CaptureJob } from "./routes/capture-session.js";
import { authRoutes } from "./routes/auth.js";
import { contextRoutes } from "./routes/context.js";
import { installRoutes } from "./routes/install.js";
import { metaRoutes } from "./routes/meta.js";
import { metricsRoutes } from "./routes/metrics.js";
import { projectRoutes } from "./routes/projects.js";

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

export interface AppDeps {
  /** Inyectable para poder testear las rutas de captura sin llamar a un modelo real. */
  distill?: DistillSessionFn;
  /** Llamadas al modelo en paralelo. Baja porque el proveedor limita por API key. */
  captureConcurrency?: number;
}

/** Construye la API HTTP completa (auth + contexto + captura). Sin side effects. */
export function createApp(deps: AppDeps = {}): Hono {
  const app = new Hono();

  // Cabeceras de seguridad antes que nada. Los defaults de Hono no incluyen CSP, que es lo
  // que rompería las fuentes externas de la UI.
  app.use("*", secureHeaders());
  const distill = deps.distill ?? distillSession;
  const captureQueue = createCaptureQueue<CaptureJob>({
    concurrency: deps.captureConcurrency ?? getEnvNum("CORTEX_CAPTURE_CONCURRENCY", 1),
    run: makeCaptureRunner(distill),
  });

  // Health de verdad: sin base de datos el servidor no sirve para nada, así que decirlo
  // "ok" solo porque el proceso vive engaña al orquestador y al que mira el dashboard.
  app.get("/health", async (c) => {
    const db = await pingDatabase();
    return c.json({ ok: db, service: "cortex-server", db: db ? "ok" : "down" }, db ? 200 : 503);
  });

  app.route("/", metricsRoutes);
  app.route("/", metaRoutes);
  app.route("/", installRoutes);
  app.route("/", authRoutes);
  app.route("/", contextRoutes);
  app.route("/", projectRoutes);
  app.route("/", captureSessionRoutes({ distill, queue: captureQueue }));

  // Errores no controlados: log completo en servidor + 500 JSON genérico,
  // sin filtrar detalles internos al cliente.
  app.onError((err, c) => {
    console.error("[cortex-server] error no controlado:", err);
    return c.json({ error: "Internal error." }, 500);
  });

  return app;
}

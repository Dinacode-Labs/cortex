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
 * Cortex's HTTP API (Hono). Email + OTP authentication plus authenticated context endpoints
 * (the hooks and connectors use these instead of touching the database directly): writes are
 * attributed to the user (created_by = email) and respect permissions. See docs/decisions.md.
 *
 * This module has NO import-time effects (neither loadEnv nor serve): `createApp()` only
 * COMPOSES the app -- health + routers (`routes/`, one per resource) + onError -- and the thin
 * entrypoint (`index.ts`) starts it. That way the tests can exercise the routes with
 * `app.request()` without standing up a server.
 */

export interface AppDeps {
  /** Injectable so the capture routes can be tested without calling a real model. */
  distill?: DistillSessionFn;
  /** Parallel model calls. Low, because the provider limits per API key. */
  captureConcurrency?: number;
}

/** Builds the whole HTTP API (auth + context + capture). No side effects. */
export function createApp(deps: AppDeps = {}): Hono {
  const app = new Hono();

  // Security headers before anything else. Hono's defaults do not include a CSP, which is
  // what would break the UI's external fonts.
  app.use("*", secureHeaders());
  const distill = deps.distill ?? distillSession;
  const captureQueue = createCaptureQueue<CaptureJob>({
    concurrency: deps.captureConcurrency ?? getEnvNum("CORTEX_CAPTURE_CONCURRENCY", 1),
    run: makeCaptureRunner(distill),
  });

  // A real health check: with no database the server is useless, so saying "ok" merely
  // because the process is alive misleads both the orchestrator and whoever reads the
  // dashboard.
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

  // Unhandled errors: a full log on the server plus a generic JSON 500, leaking no internal
  // detail to the client.
  app.onError((err, c) => {
    console.error("[cortex-server] unhandled error:", err);
    return c.json({ error: "Internal error." }, 500);
  });

  return app;
}

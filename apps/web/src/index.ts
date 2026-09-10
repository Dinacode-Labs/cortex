import { serve } from "@hono/node-server";
import { closeSql } from "@cortex/database";
import { loadEnv } from "@cortex/shared";
import { wireLlm } from "@cortex/agents";
import { createApp } from "./app.js";

/**
 * Entrypoint fino de la UI web: entorno + LLM + servidor. Toda la app (middleware
 * de sesión y rutas) vive en `app.ts` sin side effects, para poder testearla con
 * `app.request()` sin arrancar un servidor.
 */
loadEnv();
wireLlm();

const app = createApp();
const port = Number(process.env.WEB_PORT ?? 8080);
const hostname = process.env.CORTEX_BIND_HOST ?? "127.0.0.1";
const server = serve({ fetch: app.fetch, port, hostname }, (info) => {
  console.log(`[cortex-web] UI en http://${hostname}:${info.port}`);
});

const shutdown = async () => {
  server.close();
  await closeSql().catch(() => {});
  process.exit(0);
};
process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);

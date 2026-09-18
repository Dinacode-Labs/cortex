import { serve } from "@hono/node-server";
import { closeSql } from "@cortex/database";
import { loadEnv } from "@cortex/shared";
import { wireLlm } from "@cortex/agents";
import { createApp } from "./app.js";

/**
 * Thin entrypoint for the web UI: environment + LLM + server. The whole app (session
 * middleware and routes) lives in `app.ts` with no side effects, so it can be tested with
 * `app.request()` without starting a server.
 */
loadEnv();
wireLlm();

const app = createApp();
const port = Number(process.env.WEB_PORT ?? 8080);
const hostname = process.env.CORTEX_BIND_HOST ?? "127.0.0.1";
const server = serve({ fetch: app.fetch, port, hostname }, (info) => {
  console.log(`[cortex-web] UI at http://${hostname}:${info.port}`);
});

const shutdown = async () => {
  server.close();
  await closeSql().catch(() => {});
  process.exit(0);
};
process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);

import { serve } from "@hono/node-server";
import { closeSql } from "@cortex/database";
import { isLlmEnabled, loadEnv } from "@cortex/shared";
import { wireLlm } from "@cortex/agents";
import { createMcpHttpApp } from "./http-app.js";

/**
 * Thin entrypoint for MCP over HTTP: environment + LLM + server. The app (sessions, auth and
 * routes) lives in `http-app.ts` with no side effects. The CLI (`cortex mcp-http`) imports
 * THIS file by path: importing it starts the server (the entrypoint's deliberate side effect).
 */
loadEnv();
wireLlm();

const app = createMcpHttpApp();
const requireAuth = process.env.CORTEX_MCP_AUTH !== "off"; // for the log only (the app reads it when it is built)
const port = Number(process.env.CORTEX_MCP_PORT ?? "8788");
const hostname = process.env.CORTEX_BIND_HOST ?? "127.0.0.1";
serve({ fetch: app.fetch, port, hostname }, (info) => {
  console.error(`[cortex-mcp] HTTP en http://${hostname}:${info.port}/mcp (auth: ${requireAuth ? "on" : "off"}, LLM: ${isLlmEnabled() ? "on" : "off"})`);
});

const shutdown = async () => {
  await closeSql().catch(() => {});
  process.exit(0);
};
process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);

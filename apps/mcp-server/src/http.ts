import { serve } from "@hono/node-server";
import { closeSql } from "@cortex/database";
import { isLlmEnabled, loadEnv } from "@cortex/shared";
import { wireLlm } from "@cortex/agents";
import { createMcpHttpApp } from "./http-app.js";

/**
 * Entrypoint fino del MCP por HTTP: entorno + LLM + servidor. La app (sesiones,
 * auth y rutas) vive en `http-app.ts` sin side effects. El CLI (`cortex mcp-http`)
 * importa ESTE fichero por ruta: importarlo arranca el servidor (side effect
 * deliberado del entrypoint).
 */
loadEnv();
wireLlm();

const app = createMcpHttpApp();
const requireAuth = process.env.CORTEX_MCP_AUTH !== "off"; // solo para el log (la app lo lee al construirse)
const port = Number(process.env.CORTEX_MCP_PORT ?? "8788");
serve({ fetch: app.fetch, port }, (info) => {
  console.error(`[cortex-mcp] HTTP en http://localhost:${info.port}/mcp (auth: ${requireAuth ? "on" : "off"}, LLM: ${isLlmEnabled() ? "on" : "off"})`);
});

const shutdown = async () => {
  await closeSql().catch(() => {});
  process.exit(0);
};
process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);

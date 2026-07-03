import { serve } from "@hono/node-server";
import { closeSql } from "@cortex/database";
import { loadEnv } from "@cortex/shared";
import { wireLlm } from "@cortex/agents";
import { createApp } from "./app.js";

/**
 * Entrypoint fino de la API HTTP: entorno + LLM + servidor. Toda la app (auth +
 * endpoints de contexto) vive en `app.ts` sin side effects, para poder testearla
 * con `app.request()` sin arrancar un servidor.
 */
loadEnv();
wireLlm(); // hooks LLM (reconciliación en /capture) + sink de uso de embeddings

const app = createApp();
const port = Number(process.env.CORTEX_SERVER_PORT ?? "8787");
const server = serve({ fetch: app.fetch, port }, (info) => {
  console.log(`Cortex server escuchando en http://localhost:${info.port}`);
});

async function shutdown(): Promise<void> {
  server.close();
  await closeSql();
  process.exit(0);
}
process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);

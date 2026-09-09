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

// Sin dominio permitido, cualquier email del mundo puede pedir un OTP y crearse una
// cuenta. Es un default deliberado (el producto no conoce el dominio de quien lo
// despliega), pero en producción es casi siempre un olvido: se avisa alto y claro.
if (!process.env.CORTEX_AUTH_DOMAIN?.trim()) {
  console.warn(
    "[cortex-server] CORTEX_AUTH_DOMAIN está vacío: CUALQUIER email puede registrarse. " +
      "Fíjalo en producción (p. ej. CORTEX_AUTH_DOMAIN=tu-dominio.com).",
  );
}

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

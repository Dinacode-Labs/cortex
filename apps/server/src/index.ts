import { serve } from "@hono/node-server";
import { closeSql } from "@cortex/database";
import { loadEnv } from "@cortex/shared";
import { wireLlm } from "@cortex/agents";
import { validateEmailConfig } from "@cortex/core";
import { createApp } from "./app.js";

/**
 * Entrypoint fino de la API HTTP: entorno + LLM + servidor. Toda la app (auth +
 * endpoints de contexto) vive en `app.ts` sin side effects, para poder testearla
 * con `app.request()` sin arrancar un servidor.
 */
loadEnv();
wireLlm(); // hooks LLM (reconciliación en /capture) + sink de uso de embeddings

// Falla pronto si el proveedor de email elegido no puede funcionar: descubrirlo cuando un
// usuario se queda sin poder entrar es mucho peor que no arrancar.
for (const w of validateEmailConfig()) console.warn(w);

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
// Por defecto solo escucha en local: exponerse a la red es una decisión del que despliega,
// no un default. En el contenedor se pone a 0.0.0.0 y quien publica puertos es Caddy.
const hostname = process.env.CORTEX_BIND_HOST ?? "127.0.0.1";
const server = serve({ fetch: app.fetch, port, hostname }, (info) => {
  console.log(`Cortex server escuchando en http://${hostname}:${info.port}`);
});

async function shutdown(): Promise<void> {
  server.close();
  await closeSql();
  process.exit(0);
}
process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);

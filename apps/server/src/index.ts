import { serve } from "@hono/node-server";
import { closeSql } from "@cortex/database";
import { loadEnv } from "@cortex/shared";
import { wireLlm } from "@cortex/agents";
import { validateEmailConfig } from "@cortex/core";
import { createApp } from "./app.js";

/**
 * Thin entrypoint for the HTTP API: environment + LLM + server. The whole app (auth plus the
 * context endpoints) lives in `app.ts` with no side effects, so it can be tested with
 * `app.request()` without starting a server.
 */
loadEnv();
wireLlm(); // LLM hooks (reconciliation in /capture) plus the embedding usage sink

// Fail early when the chosen email provider cannot work: finding out when a user is locked out
// is far worse than not starting.
for (const w of validateEmailConfig()) console.warn(w);

// With no allowed domain, any email address in the world can request an OTP and create an
// account. It is a deliberate default (the product does not know its deployer's domain), but
// in production it is almost always an oversight: the warning is loud and clear.
if (!process.env.CORTEX_AUTH_DOMAIN?.trim()) {
  console.warn(
    "[cortex-server] CORTEX_AUTH_DOMAIN is empty: ANY email address can register. " +
      "Set it in production (e.g. CORTEX_AUTH_DOMAIN=your-domain.com).",
  );
}

const app = createApp();
const port = Number(process.env.CORTEX_SERVER_PORT ?? "8787");
// By default it listens on localhost only: being exposed to the network is the deployer's
// decision, not a default. In the container it is set to 0.0.0.0 and Caddy publishes the ports.
const hostname = process.env.CORTEX_BIND_HOST ?? "127.0.0.1";
const server = serve({ fetch: app.fetch, port, hostname }, (info) => {
  console.log(`Cortex server listening on http://${hostname}:${info.port}`);
});

async function shutdown(): Promise<void> {
  server.close();
  await closeSql();
  process.exit(0);
}
process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);

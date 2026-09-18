import { Hono } from "hono";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import type { ClientConfig } from "@cortex/shared";
import { MIN_CLIENT_VERSION, SERVER_VERSION } from "../version.js";

/**
 * Meta endpoints: what a client needs to know about the server BEFORE authenticating.
 *
 * They exist so the CLI never has to guess anything. Without them, connecting to MCP over HTTP
 * would mean deriving its URL from the API's (changing the port by hand), which breaks as soon
 * as there is a proxy in front and both hang off the same host.
 */
export const metaRoutes = new Hono();

/** Paths relative to this file: the depth is the same from `src/` and from `dist/`. */
const TOOLBELT_PATH = resolve(import.meta.dirname, "../../../../config/toolbelt.json");

metaRoutes.get("/client-config", (c) => {
  const origin = new URL(c.req.url).origin;
  const apiUrl = process.env.CORTEX_PUBLIC_URL?.trim() || origin;
  const cfg: ClientConfig = {
    apiUrl,
    // The MCP may live on another port (dev) or under the same host behind a proxy
    // (production). The operator says which; the default is the dev compose's.
    mcpUrl: process.env.CORTEX_MCP_PUBLIC_URL?.trim() || "http://localhost:8788/mcp",
    webUrl: process.env.CORTEX_WEB_URL?.trim() || "http://localhost:8080",
    version: SERVER_VERSION,
    minClientVersion: MIN_CLIENT_VERSION,
  };
  return c.json(cfg);
});

metaRoutes.get("/version", (c) => c.json({ version: SERVER_VERSION }));

/**
 * Serves the toolbelt registry so `cortex toolbelt sync` can install it without a cloned repo.
 * Public on purpose: it holds no credentials, only which tools exist and what auth each needs.
 */
metaRoutes.get("/toolbelt.json", (c) => {
  try {
    return c.body(readFileSync(TOOLBELT_PATH, "utf8"), 200, { "content-type": "application/json" });
  } catch {
    return c.json({ error: "This server does not publish a toolbelt registry." }, 404);
  }
});

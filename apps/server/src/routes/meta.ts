import { Hono } from "hono";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import type { ClientConfig } from "@cortex/shared";
import { MIN_CLIENT_VERSION, SERVER_VERSION } from "../version.js";

/**
 * Endpoints de meta: lo que un cliente necesita saber del servidor ANTES de autenticarse.
 *
 * Existen para que el CLI no tenga que adivinar nada. Sin esto, para conectarse al MCP por
 * HTTP habría que deducir su URL a partir de la de la API (cambiando el puerto a mano), lo
 * que se rompe en cuanto hay un proxy delante y las dos cuelgan del mismo host.
 */
export const metaRoutes = new Hono();

/** Rutas relativas al fichero: la profundidad es la misma desde `src/` y desde `dist/`. */
const TOOLBELT_PATH = resolve(import.meta.dirname, "../../../../config/toolbelt.json");

metaRoutes.get("/client-config", (c) => {
  const origin = new URL(c.req.url).origin;
  const apiUrl = process.env.CORTEX_PUBLIC_URL?.trim() || origin;
  const cfg: ClientConfig = {
    apiUrl,
    // El MCP puede estar en otro puerto (dev) o colgando del mismo host tras un proxy
    // (producción). Lo dice el operador; el default es el del compose de desarrollo.
    mcpUrl: process.env.CORTEX_MCP_PUBLIC_URL?.trim() || "http://localhost:8788/mcp",
    webUrl: process.env.CORTEX_WEB_URL?.trim() || "http://localhost:8080",
    version: SERVER_VERSION,
    minClientVersion: MIN_CLIENT_VERSION,
  };
  return c.json(cfg);
});

metaRoutes.get("/version", (c) => c.json({ version: SERVER_VERSION }));

/**
 * Sirve el registry del toolbelt para que `cortex toolbelt sync` pueda instalarlo sin tener
 * el repo clonado. Público a propósito: no contiene credenciales, solo qué herramientas hay
 * y qué auth necesita cada una.
 */
metaRoutes.get("/toolbelt.json", (c) => {
  try {
    return c.body(readFileSync(TOOLBELT_PATH, "utf8"), 200, { "content-type": "application/json" });
  } catch {
    return c.json({ error: "This server does not publish a toolbelt registry." }, 404);
  }
});

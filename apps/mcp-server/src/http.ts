import { randomUUID } from "node:crypto";
import { serve } from "@hono/node-server";
import { Hono, type Context } from "hono";
import { WebStandardStreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js";
import { isInitializeRequest } from "@modelcontextprotocol/sdk/types.js";
import { closeSql } from "@cortex/database";
import { isLlmEnabled, loadEnv } from "@cortex/shared";
import { validateToken, type AuthUser } from "@cortex/core";
import { wireLlm } from "@cortex/agents";
import { buildMcpServer } from "./server.js";

/**
 * Cortex MCP — transporte HTTP (Streamable HTTP, Web-standard) AUTENTICADO. El MCP deja
 * de ser solo local (stdio): se sirve por HTTP con sesiones, exigiendo el mismo token
 * Bearer que el resto de la API (`cortex auth login`). Un McpServer por sesión.
 */
loadEnv();
wireLlm();
const REQUIRE_AUTH = process.env.CORTEX_MCP_AUTH !== "off"; // por defecto: exige token
// Sesión → su transporte + el usuario dueño (las tools del server llevan ese usuario baked).
const sessions = new Map<string, { transport: WebStandardStreamableHTTPServerTransport; email?: string }>();

const app = new Hono();
app.get("/health", (c) => c.json({ ok: true, service: "cortex-mcp" }));

/** Usuario del Bearer (o null). Con auth off, devuelve un usuario "anónimo" sin permisos finos. */
async function authUser(c: Context): Promise<AuthUser | null> {
  const m = (c.req.header("authorization") ?? "").match(/^Bearer\s+(.+)$/i);
  if (m) return validateToken(m[1]!.trim());
  return REQUIRE_AUTH ? null : ({ id: "anon", email: "", admin: false } as AuthUser);
}

const rpcError = (c: Context, code: number, message: string, status: 400 | 401) =>
  c.json({ jsonrpc: "2.0", error: { code, message }, id: null }, status);

async function handleMcp(c: Context): Promise<Response> {
  const user = await authUser(c);
  if (!user) return rpcError(c, -32001, "No autenticado (Bearer requerido).", 401);

  const sid = c.req.header("mcp-session-id");
  const existing = sid ? sessions.get(sid) : undefined;
  // La sesión pertenece a un usuario: otro token no puede reutilizar su session-id.
  if (existing && REQUIRE_AUTH && existing.email !== user.email) {
    return rpcError(c, -32001, "La sesión pertenece a otro usuario.", 401);
  }
  let transport = existing?.transport;
  let parsedBody: unknown;

  if (!transport) {
    if (c.req.method === "POST") parsedBody = await c.req.json().catch(() => undefined);
    if (!isInitializeRequest(parsedBody)) return rpcError(c, -32000, "Sesión no encontrada o se requiere 'initialize'.", 400);
    const t = new WebStandardStreamableHTTPServerTransport({
      sessionIdGenerator: () => randomUUID(),
      onsessioninitialized: (id) => {
        sessions.set(id, { transport: t, email: user.email });
      },
    });
    t.onclose = () => {
      if (t.sessionId) sessions.delete(t.sessionId);
    };
    await buildMcpServer(user).connect(t); // identidad del Bearer → atribución + permisos en las tools
    transport = t;
  }
  return transport.handleRequest(c.req.raw, parsedBody !== undefined ? { parsedBody } : undefined);
}

app.all("/mcp", handleMcp);

const port = Number(process.env.CORTEX_MCP_PORT ?? "8788");
serve({ fetch: app.fetch, port }, (info) => {
  console.error(`[cortex-mcp] HTTP en http://localhost:${info.port}/mcp (auth: ${REQUIRE_AUTH ? "on" : "off"}, LLM: ${isLlmEnabled() ? "on" : "off"})`);
});

const shutdown = async () => {
  await closeSql().catch(() => {});
  process.exit(0);
};
process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);

import { randomUUID } from "node:crypto";
import { serve } from "@hono/node-server";
import { Hono, type Context } from "hono";
import { WebStandardStreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js";
import { isInitializeRequest } from "@modelcontextprotocol/sdk/types.js";
import { closeSql } from "@cortex/database";
import { validateToken } from "@cortex/core";
import { buildMcpServer, isLlmEnabled } from "./server.js";

/**
 * Cortex MCP — transporte HTTP (Streamable HTTP, Web-standard) AUTENTICADO. El MCP deja
 * de ser solo local (stdio): se sirve por HTTP con sesiones, exigiendo el mismo token
 * Bearer que el resto de la API (`cortex auth login`). Un McpServer por sesión.
 */
const REQUIRE_AUTH = process.env.CORTEX_MCP_AUTH !== "off"; // por defecto: exige token
const transports = new Map<string, WebStandardStreamableHTTPServerTransport>();

const app = new Hono();
app.get("/health", (c) => c.json({ ok: true, service: "cortex-mcp" }));

async function authOk(c: Context): Promise<boolean> {
  if (!REQUIRE_AUTH) return true;
  const m = (c.req.header("authorization") ?? "").match(/^Bearer\s+(.+)$/i);
  return !!m && !!(await validateToken(m[1]!.trim()));
}

const rpcError = (c: Context, code: number, message: string, status: 400 | 401) =>
  c.json({ jsonrpc: "2.0", error: { code, message }, id: null }, status);

async function handleMcp(c: Context): Promise<Response> {
  if (!(await authOk(c))) return rpcError(c, -32001, "No autenticado (Bearer requerido).", 401);

  const sid = c.req.header("mcp-session-id");
  let transport = sid ? transports.get(sid) : undefined;
  let parsedBody: unknown;

  if (!transport) {
    if (c.req.method === "POST") parsedBody = await c.req.json().catch(() => undefined);
    if (!isInitializeRequest(parsedBody)) return rpcError(c, -32000, "Sesión no encontrada o se requiere 'initialize'.", 400);
    transport = new WebStandardStreamableHTTPServerTransport({
      sessionIdGenerator: () => randomUUID(),
      onsessioninitialized: (id) => {
        transports.set(id, transport!);
      },
    });
    transport.onclose = () => {
      const s = transport!.sessionId;
      if (s) transports.delete(s);
    };
    await buildMcpServer().connect(transport);
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

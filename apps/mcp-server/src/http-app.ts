import { randomUUID } from "node:crypto";
import { Hono, type Context } from "hono";
import { secureHeaders } from "hono/secure-headers";
import { WebStandardStreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js";
import { isInitializeRequest } from "@modelcontextprotocol/sdk/types.js";
import { pingDatabase } from "@cortex/database";
import { validateToken, type AuthUser } from "@cortex/core";
import { buildMcpServer } from "./server.js";

type McpSession = { transport: WebStandardStreamableHTTPServerTransport; email?: string; lastSeen: number };

/** The authentication result: a user (valid Bearer), anonymous (no token) or invalid.
 * Telling "no token" from "invalid token" matters with auth off: a token that is present but
 * expired must give a 401 (the client believes it is authenticated), not silently degrade to
 * anonymous with no attribution. */
async function authUser(c: Context): Promise<{ user: AuthUser | null; invalidToken: boolean }> {
  const m = (c.req.header("authorization") ?? "").match(/^Bearer\s+(.+)$/i);
  if (!m) return { user: null, invalidToken: false };
  const user = await validateToken(m[1]!.trim());
  return { user, invalidToken: !user };
}

const rpcError = (c: Context, code: number, message: string, status: 400 | 401) =>
  c.json({ jsonrpc: "2.0", error: { code, message }, id: null }, status);

/** The config is read from the environment WHEN THE APP IS BUILT
 *  (after the entrypoint's loadEnv, or the test's env), not when the module is imported. */
export function createMcpHttpApp(): Hono {
  const REQUIRE_AUTH = process.env.CORTEX_MCP_AUTH !== "off";
  // Session sweep (M4): an inactivity TTL and a cap on live sessions, so clients that die
  // without closing (no DELETE/onclose) do not leave transports around forever.
  const SESSION_TTL_MS = Number(process.env.CORTEX_MCP_SESSION_TTL_SEC ?? 1800) * 1000;
  const MAX_SESSIONS = Number(process.env.CORTEX_MCP_MAX_SESSIONS ?? 200);

  // Session -> its transport plus the owning user (the server's tools bake that user in).
  const sessions = new Map<string, McpSession>();

  // Every 60s, sessions inactive for longer than the TTL are closed. `transport.close()`
  // fires `onclose` (which deletes from the Map); we delete here too in case the close fails.
  // `unref()` so the process is not kept alive (essential in tests).
  setInterval(() => {
    const now = Date.now();
    for (const [sid, s] of sessions) {
      if (now - s.lastSeen > SESSION_TTL_MS) {
        sessions.delete(sid);
        s.transport.close().catch(() => {});
      }
    }
  }, 60_000).unref();

  const app = new Hono();
  app.use("*", secureHeaders());
  app.get("/health", async (c) => {
    const db = await pingDatabase();
    return c.json({ ok: db, service: "cortex-mcp", db: db ? "ok" : "down" }, db ? 200 : 503);
  });

  async function handleMcp(c: Context): Promise<Response> {
    const { user, invalidToken } = await authUser(c);
    // A token that is present but invalid/expired -> ALWAYS a 401 (even with auth off).
    if (invalidToken) return rpcError(c, -32001, "Invalid or expired token.", 401);
    // With auth OFF and no token, `user` is null -> the MCP is built WITHOUT a user (no
    // guards, like stdio) and the session is tied to no email. With a valid Bearer it behaves
    // as with auth on: the identity brings attribution and permissions.
    if (!user && REQUIRE_AUTH) return rpcError(c, -32001, "No autenticado (Bearer requerido).", 401);

    const sid = c.req.header("mcp-session-id");
    const existing = sid ? sessions.get(sid) : undefined;
    // The session belongs to a user: another token cannot reuse its session id (this only
    // applies with auth ON; with auth off, anonymous sessions have no owner).
    if (existing && REQUIRE_AUTH && existing.email !== user?.email) {
      return rpcError(c, -32001, "That session belongs to another user.", 401);
    }
    if (existing) existing.lastSeen = Date.now();
    let transport = existing?.transport;
    let parsedBody: unknown;

    if (!transport) {
      if (c.req.method === "POST") parsedBody = await c.req.json().catch(() => undefined);
      if (!isInitializeRequest(parsedBody)) return rpcError(c, -32000, "Session not found, or 'initialize' is required.", 400);
      if (sessions.size >= MAX_SESSIONS) return rpcError(c, -32000, "Demasiadas sesiones MCP activas.", 400);
      const t = new WebStandardStreamableHTTPServerTransport({
        sessionIdGenerator: () => randomUUID(),
        onsessioninitialized: (id) => {
          sessions.set(id, { transport: t, email: user?.email, lastSeen: Date.now() });
        },
      });
      t.onclose = () => {
        if (t.sessionId) sessions.delete(t.sessionId);
      };
      await buildMcpServer(user ?? undefined).connect(t); // the Bearer's identity -> attribution and permissions in the tools
      transport = t;
    }
    return transport.handleRequest(c.req.raw, parsedBody !== undefined ? { parsedBody } : undefined);
  }

  app.all("/mcp", handleMcp);

  return app;
}

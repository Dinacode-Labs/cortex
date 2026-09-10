import { randomUUID } from "node:crypto";
import { Hono, type Context } from "hono";
import { secureHeaders } from "hono/secure-headers";
import { WebStandardStreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js";
import { isInitializeRequest } from "@modelcontextprotocol/sdk/types.js";
import { pingDatabase } from "@cortex/database";
import { validateToken, type AuthUser } from "@cortex/core";
import { buildMcpServer } from "./server.js";

/**
 * Cortex MCP — app HTTP (Streamable HTTP, Web-standard) AUTENTICADA. El MCP deja
 * de ser solo local (stdio): se sirve por HTTP con sesiones, exigiendo el mismo token
 * Bearer que el resto de la API (`cortex auth login`). Un McpServer por sesión.
 *
 * Este módulo NO tiene efectos al importar (ni loadEnv ni serve): `createMcpHttpApp()`
 * construye la app completa (leyendo la config del entorno en ese momento) y el
 * entrypoint fino (`http.ts`) la arranca. Así los tests la ejercitan con `app.request()`.
 */

/** Sesión MCP: su transporte, el usuario dueño y la última actividad (para el barrido). */
type McpSession = { transport: WebStandardStreamableHTTPServerTransport; email?: string; lastSeen: number };

/** Resultado de autenticación: user (Bearer válido), anónimo (sin token) o inválido.
 * Distinguir "sin token" de "token inválido" importa con auth off: un token presente
 * pero caducado debe dar 401 (el cliente cree estar autenticado), no degradar en
 * silencio a anónimo sin atribución. */
async function authUser(c: Context): Promise<{ user: AuthUser | null; invalidToken: boolean }> {
  const m = (c.req.header("authorization") ?? "").match(/^Bearer\s+(.+)$/i);
  if (!m) return { user: null, invalidToken: false };
  const user = await validateToken(m[1]!.trim());
  return { user, invalidToken: !user };
}

const rpcError = (c: Context, code: number, message: string, status: 400 | 401) =>
  c.json({ jsonrpc: "2.0", error: { code, message }, id: null }, status);

/** Construye la app HTTP del MCP. La config se lee del entorno AL CONSTRUIR la app
 *  (tras el loadEnv del entrypoint o el env del test), no al importar el módulo. */
export function createMcpHttpApp(): Hono {
  const REQUIRE_AUTH = process.env.CORTEX_MCP_AUTH !== "off"; // por defecto: exige token
  // Barrido de sesiones (M4): TTL de inactividad y tope de sesiones vivas, para que los
  // clientes que mueren sin cerrar (sin DELETE/onclose) no dejen transportes para siempre.
  const SESSION_TTL_MS = Number(process.env.CORTEX_MCP_SESSION_TTL_SEC ?? 1800) * 1000;
  const MAX_SESSIONS = Number(process.env.CORTEX_MCP_MAX_SESSIONS ?? 200);

  // Sesión → su transporte + el usuario dueño (las tools del server llevan ese usuario baked).
  const sessions = new Map<string, McpSession>();

  // Cada 60s se cierran las sesiones inactivas > TTL. `transport.close()` dispara el
  // `onclose` (que borra del Map); borramos también aquí por si el cierre fallara.
  // `unref()` para no mantener vivo el proceso (imprescindible en tests).
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
    // Token presente pero inválido/caducado → 401 SIEMPRE (también con auth off).
    if (invalidToken) return rpcError(c, -32001, "Token inválido o caducado.", 401);
    // Con auth OFF y sin token, `user` es null → el MCP se construye SIN usuario
    // (sin guards, como stdio) y la sesión no se liga a ningún email. Con Bearer válido,
    // igual que con auth on: la identidad aporta atribución + permisos.
    if (!user && REQUIRE_AUTH) return rpcError(c, -32001, "No autenticado (Bearer requerido).", 401);

    const sid = c.req.header("mcp-session-id");
    const existing = sid ? sessions.get(sid) : undefined;
    // La sesión pertenece a un usuario: otro token no puede reutilizar su session-id
    // (solo aplica con auth ON; con auth off las sesiones anónimas no tienen dueño).
    if (existing && REQUIRE_AUTH && existing.email !== user?.email) {
      return rpcError(c, -32001, "La sesión pertenece a otro usuario.", 401);
    }
    if (existing) existing.lastSeen = Date.now(); // actividad → la sesión sigue viva
    let transport = existing?.transport;
    let parsedBody: unknown;

    if (!transport) {
      if (c.req.method === "POST") parsedBody = await c.req.json().catch(() => undefined);
      if (!isInitializeRequest(parsedBody)) return rpcError(c, -32000, "Sesión no encontrada o se requiere 'initialize'.", 400);
      // Tope de sesiones: por encima del límite no se aceptan `initialize` nuevos.
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
      await buildMcpServer(user ?? undefined).connect(t); // identidad del Bearer → atribución + permisos en las tools
      transport = t;
    }
    return transport.handleRequest(c.req.raw, parsedBody !== undefined ? { parsedBody } : undefined);
  }

  app.all("/mcp", handleMcp);

  return app;
}

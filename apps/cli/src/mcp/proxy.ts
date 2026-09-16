import { getBrandName } from "@cortex/shared";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { CallToolRequestSchema, ListToolsRequestSchema } from "@modelcontextprotocol/sdk/types.js";
import type { Transport } from "@modelcontextprotocol/sdk/shared/transport.js";

/**
 * Proxy MCP: expone por **stdio** las tools que sirve el MCP **HTTP** del servidor.
 *
 * Los agentes (Claude Code, Codex, OpenCode…) lanzan servidores MCP como procesos locales
 * por stdio. El servidor de Cortex, en cambio, sirve el MCP por HTTP con autenticación
 * Bearer, porque las tools consultan la base de datos y aplican permisos por usuario. Este
 * proxy es el puente: el agente habla stdio con un proceso local que no sabe nada de
 * Postgres, y ese proceso reenvía todo al servidor con el token de `cortex auth login`.
 *
 * Antes, la alternativa era registrar el MCP stdio del repo clonado, que hablaba con la
 * base de datos directamente **y sin guards de permisos** (ADR-0025).
 *
 * Nada aquí tiene side effects: el comando (`commands/mcp.ts`) es quien conecta el stdio.
 */

export interface ProxyOptions {
  /** Abre el transporte hacia el servidor. Se llama de nuevo si hay que reconectar. */
  connect: () => Promise<Transport>;
  serverInfo?: { name: string; version: string };
  /** Los logs van a stderr: stdout es el canal del protocolo. */
  log?: (msg: string) => void;
}

/** ¿Es un fallo de autenticación? El SDK no lo tipa, así que se mira por código y texto. */
export function isAuthError(e: unknown): boolean {
  const err = e as { code?: unknown; message?: unknown };
  if (err?.code === 401) return true;
  if ((e as { name?: string })?.name === "SinSesionError") return true;
  const msg = String(err?.message ?? e ?? "");
  return /\b401\b|unauthorized|no autenticado|No session for/i.test(msg);
}

/** ¿Se cayó la conexión con el servidor? Entonces merece la pena reintentar una vez. */
function isConnectionError(e: unknown): boolean {
  const msg = String((e as { message?: unknown })?.message ?? e ?? "");
  return /connection closed|not connected|socket hang up|ECONNRESET|ECONNREFUSED|fetch failed|session/i.test(msg);
}

/**
 * Lo que se le enseña a la persona cuando no se puede autenticar.
 *
 * Se usa el mensaje del error si lo trae, porque `resolveUpstream` sabe **qué servidor** buscó
 * y qué sesiones hay, y eso es lo que resuelve el problema. El texto genérico solo queda para
 * el caso en que el fallo venga del otro lado (un token caducado de verdad).
 */
function authHint(e: unknown): string {
  const propio = (e as { name?: string; message?: string } | undefined);
  if (propio?.name === "SinSesionError" && propio.message) return `${getBrandName()}: ${propio.message}`;
  return `${getBrandName()}: your session is not valid for this server. Run \`cortex doctor\` to see which one this folder points at, then \`cortex auth login --server <it>\`, and restart your agent.`;
}

export function createMcpProxy(opts: ProxyOptions): { server: Server; close: () => Promise<void> } {
  const log = opts.log ?? ((m: string) => console.error(`[cortex mcp] ${m}`));
  const info = opts.serverInfo ?? { name: "cortex", version: "0.0.0" };
  const server = new Server(info, { capabilities: { tools: {} } });

  let client: Client | null = null;
  let connecting: Promise<Client> | null = null;

  /** Cliente hacia el servidor, creado a demanda y reutilizado. */
  async function upstream(): Promise<Client> {
    if (client) return client;
    connecting ??= (async () => {
      const c = new Client({ name: "cortex-cli-proxy", version: info.version }, { capabilities: {} });
      c.onclose = () => {
        // La próxima llamada reconecta sola en vez de fallar para siempre.
        if (client === c) client = null;
      };
      await c.connect(await opts.connect());
      client = c;
      connecting = null;
      return c;
    })();
    try {
      return await connecting;
    } catch (e) {
      connecting = null;
      throw e;
    }
  }

  /** Ejecuta contra el servidor y reintenta UNA vez si la conexión se había caído. */
  async function withRetry<T>(fn: (c: Client) => Promise<T>): Promise<T> {
    try {
      return await fn(await upstream());
    } catch (e) {
      if (!isConnectionError(e) || isAuthError(e)) throw e;
      log(`connection lost (${(e as Error).message}); retrying once…`);
      client = null;
      return fn(await upstream());
    }
  }

  server.setRequestHandler(ListToolsRequestSchema, async () => {
    try {
      // El `inputSchema` viaja como JSON Schema y se reenvía tal cual: no hace falta
      // reconstruirlo con zod ni conocer las tools de antemano.
      return await withRetry((c) => c.listTools());
    } catch (e) {
      // Devolver una lista vacía en vez de fallar: así el agente ARRANCA aunque el
      // servidor esté caído o el token haya caducado, y el usuario ve el aviso en el log
      // en lugar de un error de inicialización.
      log(isAuthError(e) ? authHint(e) : `could not list the tools: ${(e as Error).message}`);
      return { tools: [] };
    }
  });

  server.setRequestHandler(CallToolRequestSchema, async (request) => {
    try {
      return await withRetry((c) => c.callTool(request.params));
    } catch (e) {
      // Un error de tool se responde como resultado con `isError`, no como excepción de
      // protocolo: el agente lo enseña al usuario y sigue trabajando.
      const text = isAuthError(e) ? authHint(e) : `${getBrandName()}: the tool failed (${(e as Error).message}).`;
      log(text);
      return { content: [{ type: "text", text }], isError: true };
    }
  });

  return {
    server,
    close: async () => {
      try {
        await client?.close();
      } catch {
        /* cerrando: da igual el motivo */
      }
      client = null;
      await server.close().catch(() => {});
    },
  };
}

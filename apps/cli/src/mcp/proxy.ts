import { MCP_INSTRUCTIONS, getBrandName } from "@cortex/shared";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { CallToolRequestSchema, ListToolsRequestSchema } from "@modelcontextprotocol/sdk/types.js";
import type { Transport } from "@modelcontextprotocol/sdk/shared/transport.js";

/**
 * The MCP proxy: it exposes over **stdio** the tools the server's **HTTP** MCP serves.
 *
 * Agents (Claude Code, Codex, OpenCode...) launch MCP servers as local stdio processes.
 * Cortex's server, by contrast, serves MCP over HTTP with Bearer authentication, because the
 * tools query the database and apply per-user permissions. This proxy is the bridge: the agent
 * speaks stdio to a local process that knows nothing about Postgres, and that process forwards
 * everything to the server with `cortex auth login`'s token.
 *
 * The alternative used to be registering the cloned repo's stdio MCP, which talked to the
 * database directly **and with no permission guards** (ADR-0025).
 *
 * Nothing here has side effects: the command (`commands/mcp.ts`) is what connects the stdio.
 */

export interface ProxyOptions {
  /** Opens the transport towards the server. Called again when a reconnect is needed. */
  connect: () => Promise<Transport>;
  serverInfo?: { name: string; version: string };
  /** Logs go to stderr: stdout is the protocol's channel. */
  log?: (msg: string) => void;
}

/** Is this an authentication failure? The SDK does not type it, so code and text are checked. */
export function isAuthError(e: unknown): boolean {
  const err = e as { code?: unknown; message?: unknown };
  if (err?.code === 401) return true;
  if ((e as { name?: string })?.name === "NoSessionError") return true;
  const msg = String(err?.message ?? e ?? "");
  return /\b401\b|unauthorized|not authenticated|No session for/i.test(msg);
}

/** Did the connection to the server drop? Then it is worth retrying once. */
function isConnectionError(e: unknown): boolean {
  const msg = String((e as { message?: unknown })?.message ?? e ?? "");
  return /connection closed|not connected|socket hang up|ECONNRESET|ECONNREFUSED|fetch failed|session/i.test(msg);
}

/**
 * What the person is shown when authentication is not possible.
 *
 * The error's message is used when it carries one, because `resolveUpstream` knows **which
 * server** it looked for and which sessions exist, and that is what solves the problem. The
 * generic text remains only for the case where the failure comes from the other side (a token
 * that really has expired).
 */
function authHint(e: unknown): string {
  const propio = (e as { name?: string; message?: string } | undefined);
  if (propio?.name === "NoSessionError" && propio.message) return `${getBrandName()}: ${propio.message}`;
  return `${getBrandName()}: your session is not valid for this server. Run \`cortex doctor\` to see which one this folder points at, then \`cortex auth login --server <it>\`, and restart your agent.`;
}

export function createMcpProxy(opts: ProxyOptions): { server: Server; close: () => Promise<void> } {
  const log = opts.log ?? ((m: string) => console.error(`[cortex mcp] ${m}`));
  const info = opts.serverInfo ?? { name: "cortex", version: "0.0.0" };
  // `initialize` is answered HERE, not by the server behind this: the agent never sees the
  // instructions the HTTP MCP declares, so the capture protocol has to be declared on this side.
  // Which also means it arrives with no session and with the server down, when there is nobody to
  // ask -- the same reason the tool list degrades to empty instead of failing.
  const server = new Server(info, { capabilities: { tools: {} }, instructions: MCP_INSTRUCTIONS });

  let client: Client | null = null;
  let connecting: Promise<Client> | null = null;

  async function upstream(): Promise<Client> {
    if (client) return client;
    connecting ??= (async () => {
      const c = new Client({ name: "cortex-cli-proxy", version: info.version }, { capabilities: {} });
      c.onclose = () => {
        // The next call reconnects on its own instead of failing forever.
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

  /** Runs against the server and retries ONCE if the connection had dropped. */
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
      // The `inputSchema` travels as JSON Schema and is forwarded as is: there is no need to
      // rebuild it with zod nor to know the tools in advance.
      return await withRetry((c) => c.listTools());
    } catch (e) {
      // Return an empty list rather than fail: that way the agent STARTS even when the server
      // is down or the token has expired, and the user sees the warning in the log instead of
      // an initialisation error.
      log(isAuthError(e) ? authHint(e) : `could not list the tools: ${(e as Error).message}`);
      return { tools: [] };
    }
  });

  server.setRequestHandler(CallToolRequestSchema, async (request) => {
    try {
      return await withRetry((c) => c.callTool(request.params));
    } catch (e) {
      // A tool error is answered as a result with `isError`, not as a protocol exception: the
      // agent shows it to the user and carries on working.
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
        /* closing: the reason does not matter */
      }
      client = null;
      await server.close().catch(() => {});
    },
  };
}

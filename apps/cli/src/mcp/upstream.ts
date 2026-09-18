import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import type { Transport } from "@modelcontextprotocol/sdk/shared/transport.js";
import {
  DEFAULT_SERVER_URL,
  apiBase,
  getClientConfig,
  listCredentials,
  readCredentials,
  useProjectServer,
} from "@cortex/client";

/**
 * How the CLI finds the server's MCP and which credentials it talks with.
 *
 * The order matters: asking the server (`/client-config`) is the right thing, because in
 * production the API and the MCP may hang off the same host behind a proxy, and deriving the
 * URL by changing the port only works in development.
 */

export interface UpstreamTarget {
  url: string;
  token: string;
}

/** Fallback for old servers or no network: the MCP's port in the dev compose. */
function guessFromServer(server: string): string {
  try {
    const u = new URL(server);
    if (u.port === "8787") u.port = "8788";
    return `${u.origin}${u.pathname.replace(/\/$/, "")}/mcp`.replace(/([^:])\/\/+/g, "$1/");
  } catch {
    return `${DEFAULT_SERVER_URL.replace("8787", "8788")}/mcp`;
  }
}

/**
 * Resolves which MCP to connect to and with which token. `null` when there is no session.
 *
 * The agent launches this process from the folder being worked in, so that repo's
 * `.cortex.json` is what decides the server (ADR-0033). Outside a linked repo it falls back to
 * the default: the tools still ask for the project by name and permissions still apply, so at
 * worst it is a query against the wrong memory.
 */
export async function resolveUpstream(cwd = process.cwd()): Promise<UpstreamTarget | null> {
  useProjectServer(cwd);
  const buscado = apiBase();
  const creds = readCredentials(buscado);
  if (!creds?.token) throw new NoSessionError(buscado, cwd);
  const override = process.env.CORTEX_MCP_URL?.trim();
  if (override) return { url: override, token: creds.token };
  const cfg = await getClientConfig(creds.server);
  return { url: cfg?.mcpUrl?.trim() || guessFromServer(creds.server), token: creds.token };
}

/**
 * There is no session **for this server**, which is not the same as not being signed in.
 *
 * The previous message said "you are not signed in, or your token expired" in both cases, and
 * that sends whoever reads it to run a `cortex auth login` they had already run. The real case
 * is different: the folder points at a server -- through its `.cortex.json` or through
 * `CORTEX_SERVER_URL` -- there are no credentials for, while there are credentials for another.
 * An error that misdirects costs more than one that says nothing, because it looks like it
 * knows.
 */
export class NoSessionError extends Error {
  constructor(
    readonly server: string,
    readonly cwd: string,
  ) {
    const sessions = listCredentials();
    const have = sessions.length
      ? `Signed in to: ${sessions.map((c) => `${c.server} (${c.email})`).join(", ")}.`
      : "There are no sessions on this machine.";
    const fix = sessions.some((c) => c.server !== server)
      ? `If "${server}" is not where this project lives, fix the "server" field in .cortex.json ` +
        "(or unset CORTEX_SERVER_URL). If it is, sign in to it: " +
        `cortex auth login --server ${server}`
      : `Run: cortex auth login --server ${server}`;
    super(`No session for ${server} (resolved from ${cwd}). ${have} ${fix}`);
    this.name = "NoSessionError";
  }
}

/** Authenticated HTTP transport. The SDK handles the `mcp-session-id` internally. */
export function httpTransport(target: UpstreamTarget): Transport {
  return new StreamableHTTPClientTransport(new URL(target.url), {
    requestInit: { headers: { authorization: `Bearer ${target.token}` } },
  });
}

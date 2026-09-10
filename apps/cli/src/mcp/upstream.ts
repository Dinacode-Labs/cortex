import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import type { Transport } from "@modelcontextprotocol/sdk/shared/transport.js";
import { DEFAULT_SERVER_URL, getClientConfig, readCredentials } from "@cortex/client";

/**
 * Cómo encuentra el CLI el MCP del servidor y con qué credenciales habla.
 *
 * El orden importa: preguntárselo al servidor (`/client-config`) es lo correcto, porque en
 * producción la API y el MCP pueden colgar del mismo host tras un proxy, y deducir la URL
 * cambiando el puerto solo funciona en desarrollo.
 */

export interface UpstreamTarget {
  url: string;
  token: string;
}

/** Fallback para servidores viejos o sin red: el puerto del MCP en el compose de dev. */
function guessFromServer(server: string): string {
  try {
    const u = new URL(server);
    if (u.port === "8787") u.port = "8788";
    return `${u.origin}${u.pathname.replace(/\/$/, "")}/mcp`.replace(/([^:])\/\/+/g, "$1/");
  } catch {
    return `${DEFAULT_SERVER_URL.replace("8787", "8788")}/mcp`;
  }
}

/** Resuelve a qué MCP conectarse y con qué token. `null` si no hay sesión. */
export async function resolveUpstream(): Promise<UpstreamTarget | null> {
  const creds = readCredentials();
  if (!creds?.token) return null;
  const override = process.env.CORTEX_MCP_URL?.trim();
  if (override) return { url: override, token: creds.token };
  const cfg = await getClientConfig(creds.server);
  return { url: cfg?.mcpUrl?.trim() || guessFromServer(creds.server), token: creds.token };
}

/** Transporte HTTP autenticado. El SDK gestiona el `mcp-session-id` por dentro. */
export function httpTransport(target: UpstreamTarget): Transport {
  return new StreamableHTTPClientTransport(new URL(target.url), {
    requestInit: { headers: { authorization: `Bearer ${target.token}` } },
  });
}

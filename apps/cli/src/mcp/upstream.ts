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

/**
 * Resuelve a qué MCP conectarse y con qué token. `null` si no hay sesión.
 *
 * El agente lanza este proceso desde la carpeta en la que se está trabajando, así que el
 * `.cortex.json` de ese repo es quien decide el servidor (ADR-0033). Fuera de un repo
 * vinculado se cae al de por defecto: las tools siguen pidiendo el proyecto por nombre y los
 * permisos siguen aplicando, así que como mucho es una consulta a la memoria equivocada.
 */
export async function resolveUpstream(cwd = process.cwd()): Promise<UpstreamTarget | null> {
  useProjectServer(cwd);
  const buscado = apiBase();
  const creds = readCredentials(buscado);
  if (!creds?.token) throw new SinSesionError(buscado, cwd);
  const override = process.env.CORTEX_MCP_URL?.trim();
  if (override) return { url: override, token: creds.token };
  const cfg = await getClientConfig(creds.server);
  return { url: cfg?.mcpUrl?.trim() || guessFromServer(creds.server), token: creds.token };
}

/**
 * No hay sesión **para este servidor**, que no es lo mismo que no haber iniciado sesión.
 *
 * El mensaje anterior decía «no has iniciado sesión o tu token ha caducado» en los dos casos, y
 * eso manda a quien lo lee a hacer un `cortex auth login` que ya había hecho. El caso real es
 * otro: la carpeta apunta a un servidor —por su `.cortex.json` o por `CORTEX_SERVER_URL`— del
 * que no hay credenciales, mientras sí las hay de otro. Un error que dirige mal cuesta más que
 * uno que no dice nada, porque parece que sabe.
 */
export class SinSesionError extends Error {
  constructor(
    readonly servidor: string,
    readonly cwd: string,
  ) {
    const sesiones = listCredentials();
    const tengo = sesiones.length
      ? `Signed in to: ${sesiones.map((c) => `${c.server} (${c.email})`).join(", ")}.`
      : "There are no sessions on this machine.";
    const arreglo = sesiones.some((c) => c.server !== servidor)
      ? `If "${servidor}" is not where this project lives, fix the "server" field in .cortex.json ` +
        "(or unset CORTEX_SERVER_URL). If it is, sign in to it: " +
        `cortex auth login --server ${servidor}`
      : `Run: cortex auth login --server ${servidor}`;
    super(`No session for ${servidor} (resolved from ${cwd}). ${tengo} ${arreglo}`);
    this.name = "SinSesionError";
  }
}

/** Transporte HTTP autenticado. El SDK gestiona el `mcp-session-id` por dentro. */
export function httpTransport(target: UpstreamTarget): Transport {
  return new StreamableHTTPClientTransport(new URL(target.url), {
    requestInit: { headers: { authorization: `Bearer ${target.token}` } },
  });
}

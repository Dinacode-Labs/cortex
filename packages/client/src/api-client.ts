import { normalizeServer, readCredentials } from "./credentials.js";

/**
 * Transporte HTTP hacia el servidor de Cortex, usado por el CLI, los hooks y los
 * conectores. Lee el token de `~/.cortex/credentials` y la URL base
 * (`CORTEX_SERVER_URL` > credenciales > default).
 *
 * **Degrada con elegancia a propósito**: sin sesión, sin servidor o con un 5xx devuelve
 * `ok: false` en vez de lanzar. Los hooks corren dentro de la sesión de un agente y no
 * pueden romperla porque el servidor esté caído; quien necesite distinguir el motivo tiene
 * `status` (0 = ni siquiera hubo respuesta).
 */
export const DEFAULT_SERVER_URL = "http://localhost:8787";
const DEFAULT_TIMEOUT_MS = 30_000;

/**
 * Servidor activo de este proceso, fijado por el repo en el que se está trabajando
 * (`useProjectServer`). Es lo que permite tener un Cortex por cliente sin cambiar nada a
 * mano: el `.cortex.json` dice a cuál pertenece el repo, y todo lo demás va detrás.
 */
let activeServer: string | null = null;

/** La fija el repo. `null` vuelve al servidor por defecto de las credenciales. */
export function setActiveServer(server: string | null): void {
  activeServer = server ? normalizeServer(server) : null;
}

export function apiBase(): string {
  return process.env.CORTEX_SERVER_URL || activeServer || readCredentials()?.server || DEFAULT_SERVER_URL;
}

export interface ApiResult<T = unknown> {
  ok: boolean;
  status: number;
  data: T;
}

export interface ApiRequestOptions {
  /** `false` para endpoints públicos (`/client-config`, `/auth/request`). Def. true. */
  auth?: boolean;
  /** Base alternativa: hace falta en el login, cuando aún no hay credenciales. */
  baseUrl?: string;
  timeoutMs?: number;
}

export async function apiRequest<T = unknown>(
  method: "GET" | "POST" | "PATCH" | "DELETE",
  path: string,
  body?: unknown,
  opts: ApiRequestOptions = {},
): Promise<ApiResult<T>> {
  const needsAuth = opts.auth !== false;
  // El token se busca POR SERVIDOR: con varias sesiones, mandar el de otro es un 401
  // desconcertante en el mejor caso, y en el peor una petición a quien no toca.
  const base = opts.baseUrl ?? apiBase();
  const token = readCredentials(base)?.token;
  if (needsAuth && !token) {
    return { ok: false, status: 401, data: { error: `not signed in to ${base} (cortex auth login --server ${base})` } as T };
  }
  const headers: Record<string, string> = {};
  if (needsAuth && token) headers.authorization = `Bearer ${token}`;
  if (body !== undefined) headers["content-type"] = "application/json";

  try {
    const res = await fetch(`${base}${path}`, {
      method,
      headers,
      ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
      signal: AbortSignal.timeout(opts.timeoutMs ?? DEFAULT_TIMEOUT_MS),
    });
    const data = (await res.json().catch(() => ({}))) as T;
    return { ok: res.ok, status: res.status, data };
  } catch (e) {
    // status 0 = no hubo respuesta (servidor caído, DNS, timeout).
    return { ok: false, status: 0, data: { error: (e as Error).message } as T };
  }
}

/** GET que devuelve el cuerpo o `null`. Firma histórica, usada por hooks y conectores. */
export async function apiGet<T = unknown>(path: string): Promise<T | null> {
  const res = await apiRequest<T>("GET", path);
  return res.ok ? res.data : null;
}

/** POST con el resultado completo. Firma histórica. */
export function apiPost<T = unknown>(path: string, body: unknown): Promise<ApiResult<T>> {
  return apiRequest<T>("POST", path, body);
}

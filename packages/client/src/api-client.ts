import { normalizeServer, readCredentials } from "./credentials.js";

/**
 * HTTP transport towards the Cortex server, used by the CLI, the hooks and the connectors.
 * It reads the token from `~/.cortex/credentials` and the base URL
 * (`CORTEX_SERVER_URL` > credentials > default).
 *
 * **It degrades gracefully on purpose**: with no session, no server or a 5xx it returns
 * `ok: false` instead of throwing. The hooks run inside an agent's session and cannot break
 * it just because the server is down; whoever needs to tell the reasons apart has `status`
 * (0 = there was not even a response).
 */
export const DEFAULT_SERVER_URL = "http://localhost:8787";
const DEFAULT_TIMEOUT_MS = 30_000;

/**
 * This process's active server, pinned by the repo being worked on (`useProjectServer`).
 * It is what allows one Cortex per client with nothing to switch by hand: the `.cortex.json`
 * says which one the repo belongs to, and everything else follows.
 */
let activeServer: string | null = null;

/** Pinned by the repo. `null` falls back to the credentials' default server. */
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
  /** `false` for public endpoints (`/client-config`, `/auth/request`). Defaults to true. */
  auth?: boolean;
  /** Alternative base: needed during login, when there are no credentials yet. */
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
  // The token is looked up PER SERVER: with several sessions, sending someone else's is a
  // baffling 401 at best, and at worst a request to the wrong party.
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
    // status 0 = there was no response at all (server down, DNS, timeout).
    return { ok: false, status: 0, data: { error: (e as Error).message } as T };
  }
}

/** GET returning the body or `null`. A historical signature, used by hooks and connectors. */
export async function apiGet<T = unknown>(path: string): Promise<T | null> {
  const res = await apiRequest<T>("GET", path);
  return res.ok ? res.data : null;
}

/** POST with the full result. A historical signature. */
export function apiPost<T = unknown>(path: string, body: unknown): Promise<ApiResult<T>> {
  return apiRequest<T>("POST", path, body);
}

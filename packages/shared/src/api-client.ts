import { readCredentials } from "./credentials.js";

/**
 * Cliente HTTP autenticado para hablar con el servidor de Cortex desde la CLI/hooks/
 * conectores (movido desde core: es código del LADO cliente, no del dominio). Lee el
 * token de `~/.cortex/credentials` y la URL (CORTEX_SERVER_URL > credenciales >
 * default). Degrada con elegancia: sin sesión o sin servidor devuelve null / ok:false
 * (los hooks no rompen nada).
 */
export const DEFAULT_SERVER_URL = "http://localhost:8787";

export function apiBase(): string {
  return process.env.CORTEX_SERVER_URL || readCredentials()?.server || DEFAULT_SERVER_URL;
}

export async function apiGet<T = unknown>(path: string): Promise<T | null> {
  const token = readCredentials()?.token;
  if (!token) return null;
  try {
    const res = await fetch(`${apiBase()}${path}`, { headers: { authorization: `Bearer ${token}` } });
    return res.ok ? ((await res.json()) as T) : null;
  } catch {
    return null;
  }
}

export interface ApiResult<T = unknown> {
  ok: boolean;
  status: number;
  data: T;
}

export async function apiPost<T = unknown>(path: string, body: unknown): Promise<ApiResult<T>> {
  const token = readCredentials()?.token;
  if (!token) return { ok: false, status: 0, data: { error: "no autenticado (cortex auth login)" } as T };
  try {
    const res = await fetch(`${apiBase()}${path}`, {
      method: "POST",
      headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
      body: JSON.stringify(body),
    });
    const data = (await res.json().catch(() => ({}))) as T;
    return { ok: res.ok, status: res.status, data };
  } catch (e) {
    return { ok: false, status: 0, data: { error: (e as Error).message } as T };
  }
}

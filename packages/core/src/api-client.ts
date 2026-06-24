import { existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

/**
 * Cliente HTTP autenticado para hablar con el servidor de Cortex desde la CLI/hooks/
 * conectores. Lee el token de `~/.cortex/credentials` (de `cortex auth login`) y la URL
 * (CORTEX_SERVER_URL o la guardada en las credenciales). Degrada con elegancia: si no hay
 * sesión o el servidor no responde, devuelve null / ok:false (los hooks no rompen nada).
 */
interface Creds {
  server: string;
  token: string;
  email: string;
}

function creds(): Creds | null {
  const f = join(homedir(), ".cortex", "credentials");
  if (!existsSync(f)) return null;
  try {
    return JSON.parse(readFileSync(f, "utf8")) as Creds;
  } catch {
    return null;
  }
}

export function apiBase(): string | null {
  return process.env.CORTEX_SERVER_URL || creds()?.server || null;
}
export function isAuthenticated(): boolean {
  return !!creds()?.token && !!apiBase();
}

export async function apiGet<T = unknown>(path: string): Promise<T | null> {
  const base = apiBase();
  const token = creds()?.token;
  if (!base || !token) return null;
  try {
    const res = await fetch(`${base}${path}`, { headers: { authorization: `Bearer ${token}` } });
    return res.ok ? ((await res.json()) as T) : null;
  } catch {
    return null;
  }
}

export interface ApiResult<T = any> {
  ok: boolean;
  status: number;
  data: T;
}
export async function apiPost<T = any>(path: string, body: unknown): Promise<ApiResult<T>> {
  const base = apiBase();
  const token = creds()?.token;
  if (!base || !token) return { ok: false, status: 0, data: { error: "no autenticado o sin servidor (cortex auth login)" } as T };
  try {
    const res = await fetch(`${base}${path}`, {
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

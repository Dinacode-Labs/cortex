import type { Context } from "hono";
import { validateToken, type AuthUser } from "@cortex/core";

/**
 * Helpers de autenticación Bearer compartidos por los routers (`routes/*`).
 * Sin estado y sin side effects: extraen el token de la cabecera y lo resuelven
 * a usuario contra la BD.
 */

/** Extrae el token de la cabecera `Authorization: Bearer <token>` (null si no hay). */
export function bearer(c: Context): string | null {
  const m = (c.req.header("authorization") ?? "").match(/^Bearer\s+(.+)$/i);
  return m ? m[1]!.trim() : null;
}

/** Resuelve el usuario autenticado a partir del Bearer (null si no hay sesión válida). */
export async function currentUser(c: Context): Promise<AuthUser | null> {
  const token = bearer(c);
  return token ? validateToken(token) : null;
}

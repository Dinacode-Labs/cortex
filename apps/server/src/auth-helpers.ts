import type { Context } from "hono";
import { validateToken, type AuthUser } from "@cortex/core";

/**
 * Bearer authentication helpers shared by the routers (`routes/*`). Stateless and free of side
 * effects: they pull the token out of the header and resolve it to a user against the database.
 */

export function bearer(c: Context): string | null {
  const m = (c.req.header("authorization") ?? "").match(/^Bearer\s+(.+)$/i);
  return m ? m[1]!.trim() : null;
}

export async function currentUser(c: Context): Promise<AuthUser | null> {
  const token = bearer(c);
  return token ? validateToken(token) : null;
}

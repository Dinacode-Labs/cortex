import type { Context } from "hono";
import { authenticateAccount, isAdmin, type Account, type SessionUser } from "@cortex/core";

export function bearer(c: Context): string | null {
  const m = (c.req.header("authorization") ?? "").match(/^Bearer\s+(.+)$/i);
  return m ? m[1]!.trim() : null;
}

export async function currentAccount(c: Context): Promise<Account | null> {
  const token = bearer(c);
  return token ? authenticateAccount(token) : null;
}

export async function currentUser(c: Context): Promise<SessionUser | null> {
  return (await currentAccount(c))?.user ?? null;
}

/** The `user` that POST /auth/verify and GET /auth/me have always returned, and the installed
 * CLI reads (ADR-0062): it stays `{ id, email, admin }` whatever `SessionUser` grows into. */
export function accountJson(account: Account): { id: string; email: string; admin: boolean } {
  return { id: account.id, email: account.user.email, admin: isAdmin(account.user) };
}

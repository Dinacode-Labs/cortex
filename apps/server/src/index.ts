import { serve } from "@hono/node-server";
import { Hono, type Context } from "hono";
import { closeSql } from "@cortex/database";
import { loadEnv } from "@cortex/shared";
import { requestOtp, revokeToken, validateToken, verifyOtp, type AuthUser } from "@cortex/core";

/**
 * API HTTP de Cortex (Hono). Primer slice: autenticación email + OTP. Es la base para
 * atribución (created_by = email) y permisos — y el sustituto del acceso directo a la
 * BD que hoy hacen hooks/CLI. Ver docs/decisions.md.
 */
loadEnv();

const app = new Hono();

app.get("/health", (c) => c.json({ ok: true, service: "cortex-server" }));

// --- Auth (email + OTP) ------------------------------------------------------
app.post("/auth/request", async (c) => {
  const { email } = await c.req.json().catch(() => ({}) as { email?: string });
  if (!email) return c.json({ error: "Falta 'email'." }, 400);
  try {
    await requestOtp(email);
    return c.json({ ok: true }); // no revelamos si el email existe
  } catch (e) {
    return c.json({ error: (e as Error).message }, 400);
  }
});

app.post("/auth/verify", async (c) => {
  const { email, code } = await c.req.json().catch(() => ({}) as { email?: string; code?: string });
  if (!email || !code) return c.json({ error: "Faltan 'email' y/o 'code'." }, 400);
  try {
    const { token, user } = await verifyOtp(email, code);
    return c.json({ token, user });
  } catch (e) {
    return c.json({ error: (e as Error).message }, 401);
  }
});

function bearer(c: Context): string | null {
  const m = (c.req.header("authorization") ?? "").match(/^Bearer\s+(.+)$/i);
  return m ? m[1]!.trim() : null;
}

async function currentUser(c: Context): Promise<AuthUser | null> {
  const token = bearer(c);
  return token ? validateToken(token) : null;
}

app.get("/auth/me", async (c) => {
  const user = await currentUser(c);
  return user ? c.json({ user }) : c.json({ error: "No autenticado." }, 401);
});

app.post("/auth/logout", async (c) => {
  const token = bearer(c);
  if (token) await revokeToken(token);
  return c.json({ ok: true });
});

const port = Number(process.env.CORTEX_SERVER_PORT ?? "8787");
const server = serve({ fetch: app.fetch, port }, (info) => {
  console.log(`Cortex server escuchando en http://localhost:${info.port}`);
});

async function shutdown(): Promise<void> {
  server.close();
  await closeSql();
  process.exit(0);
}
process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);

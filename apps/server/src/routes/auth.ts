import { Hono } from "hono";
import { z } from "zod";
import { createUiTicket, requestOtp, revokeToken, verifyOtp } from "@cortex/core";
import { bearer, currentUser } from "../auth-helpers.js";
import { parseBody } from "../validate.js";

/** Rutas de autenticación (email + OTP) y ciclo de vida de la sesión. */
export const authRoutes = new Hono();

// --- Schemas de REQUEST (zod v3) ----------------------------------------------
const authRequestSchema = z.object({ email: z.string().min(1) });
const authVerifySchema = z.object({ email: z.string().min(1), code: z.string().min(1) });

authRoutes.post("/auth/request", async (c) => {
  const body = await parseBody(c, authRequestSchema);
  if (body instanceof Response) return body;
  try {
    await requestOtp(body.email);
    return c.json({ ok: true }); // no revelamos si el email existe
  } catch (e) {
    return c.json({ error: (e as Error).message }, 400);
  }
});

authRoutes.post("/auth/verify", async (c) => {
  const body = await parseBody(c, authVerifySchema);
  if (body instanceof Response) return body;
  try {
    const { token, user } = await verifyOtp(body.email, body.code);
    return c.json({ token, user });
  } catch (e) {
    return c.json({ error: (e as Error).message }, 401);
  }
});

authRoutes.get("/auth/me", async (c) => {
  const user = await currentUser(c);
  return user ? c.json({ user }) : c.json({ error: "Not authenticated." }, 401);
});

// Ticket de un solo uso para abrir la UI (cortex ui). El token de CLI no viaja en la URL.
authRoutes.post("/auth/ui-ticket", async (c) => {
  const token = bearer(c);
  const ticket = token ? await createUiTicket(token) : null;
  return ticket ? c.json({ ticket }) : c.json({ error: "Not authenticated." }, 401);
});

authRoutes.post("/auth/logout", async (c) => {
  const token = bearer(c);
  if (token) await revokeToken(token);
  return c.json({ ok: true });
});

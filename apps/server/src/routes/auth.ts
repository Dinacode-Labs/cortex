import { Hono } from "hono";
import { clientIp, tooManyRequests } from "../rate-limit.js";
import { z } from "zod";
import { createUiTicket, requestOtp, revokeToken, verifyOtp } from "@cortex/core";
import { bearer, currentUser } from "../auth-helpers.js";
import { parseBody } from "../validate.js";

export const authRoutes = new Hono();

const authRequestSchema = z.object({ email: z.string().min(1) });
const authVerifySchema = z.object({ email: z.string().min(1), code: z.string().min(1) });

authRoutes.post("/auth/request", async (c) => {
  // The per-IP limit comes BEFORE looking at the body: otherwise a burst costs just as much.
  if (tooManyRequests(clientIp(c))) {
    return c.json({ error: "Too many codes requested from here. Wait a few minutes and try again." }, 429);
  }
  const body = await parseBody(c, authRequestSchema);
  if (body instanceof Response) return body;
  try {
    await requestOtp(body.email);
    return c.json({ ok: true }); // we do not reveal whether the email exists
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

// Single-use ticket for opening the UI (cortex ui). The CLI token never travels in the URL.
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

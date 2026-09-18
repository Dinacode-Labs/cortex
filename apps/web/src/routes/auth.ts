import { Hono } from "hono";
import { deleteCookie, setCookie } from "hono/cookie";
import { redeemUiTicket } from "@cortex/core";
import { loginPage, type WebEnv } from "../middleware/session.js";

const WEB_COOKIE_TTL = 60 * 60 * 24 * 30; // 30 days

/** Routes EXEMPT from the session gate (mounted before it in app.ts). */
export const authRoutes = new Hono<WebEnv>();

// CLI handshake -> session cookie. `cortex ui` opens /auth/cli?ticket=... (single use): the
// ticket is exchanged for a fresh web session (the CLI token never travels in the URL).
authRoutes.get("/auth/cli", async (c) => {
  const ticket = c.req.query("ticket");
  const session = ticket ? ((await redeemUiTicket(ticket))?.token ?? null) : null;
  if (!session) return c.html(loginPage("That link is invalid or expired. Run `cortex ui` again."), 401);
  setCookie(c, "cortex_session", session, {
    httpOnly: true,
    sameSite: "Lax",
    path: "/",
    maxAge: WEB_COOKIE_TTL,
    secure: process.env.NODE_ENV === "production", // in production the cookie only travels over HTTPS
  });
  return c.redirect("/");
});

authRoutes.get("/logout", (c) => {
  deleteCookie(c, "cortex_session", { path: "/" });
  return c.html(loginPage("Signed out."));
});

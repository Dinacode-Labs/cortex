import { Hono } from "hono";
import { deleteCookie, setCookie } from "hono/cookie";
import { redeemUiTicket } from "@cortex/core";
import { loginPage, type WebEnv } from "../middleware/session.js";

const WEB_COOKIE_TTL = 60 * 60 * 24 * 30; // 30 días

/** Rutas EXENTAS del gate de sesión (se montan antes que él en app.ts). */
export const authRoutes = new Hono<WebEnv>();

// Handshake CLI → cookie de sesión. `cortex ui` abre /auth/cli?ticket=… (un solo uso):
// el ticket se canjea por una sesión web nueva (el token de CLI nunca viaja en la URL).
authRoutes.get("/auth/cli", async (c) => {
  const ticket = c.req.query("ticket");
  const session = ticket ? ((await redeemUiTicket(ticket))?.token ?? null) : null;
  if (!session) return c.html(loginPage("That link is invalid or expired. Run `cortex ui` again."), 401);
  setCookie(c, "cortex_session", session, {
    httpOnly: true,
    sameSite: "Lax",
    path: "/",
    maxAge: WEB_COOKIE_TTL,
    secure: process.env.NODE_ENV === "production", // en producción la cookie solo viaja por HTTPS
  });
  return c.redirect("/");
});

authRoutes.get("/logout", (c) => {
  deleteCookie(c, "cortex_session", { path: "/" });
  return c.html(loginPage("Signed out."));
});

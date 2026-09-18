import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { Hono } from "hono";

/** The installer (curl -fsSL <server>/install.sh | sh). It injects the server's URL. */
export const installRoutes = new Hono();

// ABSOLUTE path to the script, relative to THIS file (apps/server/src/routes -> repo root).
const INSTALL_SH = resolve(import.meta.dirname, "../../../../scripts/install.sh");

installRoutes.get("/install.sh", (c) => {
  let sh: string;
  try {
    sh = readFileSync(INSTALL_SH, "utf8");
  } catch {
    return c.text("# install.sh no disponible", 500);
  }
  const publicUrl = process.env.CORTEX_PUBLIC_URL || new URL(c.req.url).origin;
  return c.body(sh.replaceAll("__CORTEX_SERVER_URL__", publicUrl), 200, { "content-type": "text/x-shellscript; charset=utf-8" });
});

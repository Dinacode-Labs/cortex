import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { Hono } from "hono";

/** Instalador (curl -fsSL <servidor>/install.sh | sh). Inyecta la URL del servidor. */
export const installRoutes = new Hono();

// Ruta ABSOLUTA al script, relativa a ESTE fichero (apps/server/src/routes → raíz del repo).
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

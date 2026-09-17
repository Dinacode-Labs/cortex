import { Hono } from "hono";
import { checkProjectAccess, getProjectGraph } from "@cortex/core";
import type { WebEnv } from "../middleware/session.js";

/**
 * Datos del grafo. La página que los pinta es `/p/<slug>/map` (ADR-0050).
 *
 * NO puede colgar de `/api`: el Caddyfile entrega ese prefijo entero al servidor de API
 * (`handle_path /api/*`), que no tiene esta ruta. Colgada ahí respondía 404 en el despliegue
 * —el mapa se quedaba en negro— aunque funcionase al levantar `apps/web` a pelo.
 */
export const graphRoutes = new Hono<WebEnv>();

graphRoutes.get("/graph.json", async (c) => {
  const project = c.req.query("project") ?? "";
  // Lo consume `/p/<slug>/map`: misma política, respuesta JSON.
  if (project) {
    const access = await checkProjectAccess(c.get("user")?.email ?? null, { name: project });
    if (access.status === "not_found") return c.json({ error: "project not found" }, 404);
    if (access.status === "forbidden") return c.json({ error: "no access" }, 403);
  }
  // El formulario manda un hidden "0" ANTES del checkbox, así que llegan los dos valores:
  // vale el último, que es lo que el navegador entiende por el estado de la casilla.
  const includeEntries = (c.req.queries("entries")?.at(-1) ?? "1") !== "0";
  const graph = await getProjectGraph(project, { includeEntries });
  return c.json(graph);
});

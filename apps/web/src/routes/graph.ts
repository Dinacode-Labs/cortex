import { Hono } from "hono";
import { checkProjectAccess, getProjectGraph } from "@cortex/core";
import type { WebEnv } from "../middleware/session.js";

/** Datos del grafo. La página que los pinta es `/p/<slug>/map` (ADR-0050). */
export const graphRoutes = new Hono<WebEnv>();

graphRoutes.get("/api/graph", async (c) => {
  const project = c.req.query("project") ?? "";
  // Lo consume `/p/<slug>/map`: misma política, respuesta JSON.
  if (project) {
    const access = await checkProjectAccess(c.get("user")?.email ?? null, { name: project });
    if (access.status === "not_found") return c.json({ error: "project not found" }, 404);
    if (access.status === "forbidden") return c.json({ error: "no access" }, 403);
  }
  const includeEntries = c.req.query("entries") !== "0";
  const graph = await getProjectGraph(project, { includeEntries });
  return c.json(graph);
});

import { Hono } from "hono";
import { checkProjectAccess, getProjectGraph } from "@cortex/core";
import type { WebEnv } from "../middleware/session.js";

/** The graph's data. The page that paints it is `/p/<slug>/map` (ADR-0050). */
export const graphRoutes = new Hono<WebEnv>();

graphRoutes.get("/api/graph", async (c) => {
  const project = c.req.query("project") ?? "";
  // Consumed by `/p/<slug>/map`: the same policy, a JSON response.
  if (project) {
    const access = await checkProjectAccess(c.get("user")?.email ?? null, { name: project });
    if (access.status === "not_found") return c.json({ error: "project not found" }, 404);
    if (access.status === "forbidden") return c.json({ error: "no access" }, 403);
  }
  const includeEntries = c.req.query("entries") !== "0";
  const graph = await getProjectGraph(project, { includeEntries });
  return c.json(graph);
});

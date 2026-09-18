import { Hono } from "hono";
import { checkProjectAccess, getProjectGraph } from "@cortex/core";
import type { WebEnv } from "../middleware/session.js";

/**
 * The graph's data. The page that paints it is `/p/<slug>/map` (ADR-0050).
 *
 * It can NOT hang off `/api`: the Caddyfile hands that whole prefix to the API server
 * (`handle_path /api/*`), which does not have this route. Hanging off there it answered 404 in
 * the deployment — the map stayed black — even though it worked when `apps/web` was run on its
 * own.
 */
export const graphRoutes = new Hono<WebEnv>();

graphRoutes.get("/graph.json", async (c) => {
  const project = c.req.query("project") ?? "";
  // Consumed by `/p/<slug>/map`: the same policy, a JSON response.
  if (project) {
    const access = await checkProjectAccess(c.get("user")?.email ?? null, { name: project });
    if (access.status === "not_found") return c.json({ error: "project not found" }, 404);
    if (access.status === "forbidden") return c.json({ error: "no access" }, 403);
  }
  // The form sends a hidden "0" BEFORE the checkbox, so both values arrive: the last one wins,
  // which is what the browser means by the state of the box.
  const includeEntries = (c.req.queries("entries")?.at(-1) ?? "1") !== "0";
  const graph = await getProjectGraph(project, { includeEntries });
  return c.json(graph);
});

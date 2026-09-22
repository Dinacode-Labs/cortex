import { Hono } from "hono";
import { findProjectByName } from "@cortex/core";
import type { WebEnv } from "../middleware/session.js";

/**
 * The old addresses keep working (ADR-0050).
 *
 * The UI's URLs live in bookmarks, in open tabs and in links somebody pasted into a chat weeks
 * ago. Changing the structure and leaving 404s behind turns an improvement into an annoyance
 * for precisely the people who used it most, so every old path leads to its new home. They go
 * away when they stop getting visits, not before.
 */
export const redirectRoutes = new Hono<WebEnv>();

/** `?project=<name>` was how a project used to be identified; now it is the slug. */
async function slugOf(name: string | undefined): Promise<string | null> {
  if (!name) return null;
  const p = await findProjectByName(name);
  return p?.slug ?? null;
}

const oldPaths: { path: string; section: string }[] = [
  { path: "/lint", section: "/health" },
  { path: "/pack", section: "/agents" },
  { path: "/graph", section: "/map" },
  { path: "/code", section: "/code" },
  { path: "/ask", section: "/ask" },
];

for (const { path, section } of oldPaths) {
  redirectRoutes.get(path, async (c) => {
    const slug = await slugOf(c.req.query("project"));
    if (!slug) return c.redirect("/", 302);
    const q = c.req.query("q");
    return c.redirect(`/p/${slug}${section}${q ? `?q=${encodeURIComponent(q)}` : ""}`, 301);
  });
}

redirectRoutes.get("/projects", (c) => c.redirect("/", 301));

/** Cost became an operator's concern. */
redirectRoutes.get("/usage", (c) => c.redirect("/admin/usage", 301));

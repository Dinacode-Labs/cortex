import { Hono } from "hono";
import { defaultCriterion } from "@cortex/agents";
import {
  canAccessProject,
  chainAt,
  effectiveCriterion,
  findProjectBySlug,
  getAgentPrompts,
  NotAnAdminError,
  setAgentPrompts,
  type AgentPromptView,
} from "@cortex/core";
import { updateRootAgentPromptsRequest, type AgentPromptsResponse } from "@cortex/shared";
import { currentUser } from "../auth-helpers.js";
import { parseBody } from "../validate.js";

/**
 * What the agents are told, at root and on each project (ADR-0088). A project's own text is
 * changed with `PATCH /projects/:slug`, next to its other settings; root has its own `PATCH`
 * because it belongs to no project.
 */
export const agentPromptRoutes = new Hono();

function present(views: AgentPromptView[]): AgentPromptsResponse {
  return {
    prompts: views.map((view) => ({
      role: view.role,
      default: defaultCriterion(view.role),
      inherited: view.inherited,
      own: view.own && { text: view.own.text, updatedBy: view.own.updatedBy, updatedAt: view.own.updatedAt.toISOString() },
      effective: effectiveCriterion(defaultCriterion(view.role), chainAt(view)),
    })),
  };
}

agentPromptRoutes.get("/agent-prompts", async (c) => {
  if (!(await currentUser(c))) return c.json({ error: "Not authenticated." }, 401);
  return c.json(present(await getAgentPrompts(null)));
});

agentPromptRoutes.patch("/agent-prompts", async (c) => {
  const user = await currentUser(c);
  if (!user) return c.json({ error: "Not authenticated." }, 401);
  const body = await parseBody(c, updateRootAgentPromptsRequest);
  if (body instanceof Response) return body;
  try {
    await setAgentPrompts(null, body.agentPrompts, user);
  } catch (e) {
    if (e instanceof NotAnAdminError) return c.json({ error: e.message }, 403);
    throw e;
  }
  return c.json(present(await getAgentPrompts(null)));
});

agentPromptRoutes.get("/projects/:slug/agent-prompts", async (c) => {
  const user = await currentUser(c);
  if (!user) return c.json({ error: "Not authenticated." }, 401);
  const project = await findProjectBySlug(c.req.param("slug"));
  if (!project || !(await canAccessProject(project, user))) return c.json({ error: "Project not found." }, 404);
  return c.json(present(await getAgentPrompts(project.slug!)));
});

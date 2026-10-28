import { Hono } from "hono";
import { html } from "hono/html";
import { describeRoleModel, isLlmEnabled, quotaLeft } from "@cortex/agents";
import {
  getAgentModels,
  getAgentPrompts,
  InvalidAgentModelError,
  isAdmin,
  setAgentModels,
  setAgentPrompts,
  type AgentModelChanges,
  type AgentPromptView,
  type SavedAgentModel,
} from "@cortex/core";
import { AGENT_PROMPT_MAX_LENGTH, agentPromptChanges, agentRole, type AgentPromptChanges, type AgentRole } from "@cortex/shared";
import { layout } from "../views/layout.js";
import { adminTabs } from "../views/admin-nav.js";
import { agentsAtAGlance, rootAgentPromptsPanel, type AgentModelView } from "../views/agent-prompts.js";
import { requireProjectPage } from "../middleware/access.js";
import type { WebEnv } from "../middleware/session.js";

/**
 * What the agents are told (ADR-0088): root under the admin area, because it is about the whole
 * installation, and each project's under its Settings, next to what it keeps. The model each runs
 * on is the installation's too, so it is only set from the admin area (ADR-0101).
 */
export const agentPromptRoutes = new Hono<WebEnv>();

const TOO_LONG = `Each prompt can be at most ${AGENT_PROMPT_MAX_LENGTH} characters.`;

/**
 * Only the roles whose text changed are sent, so saving the form untouched does not sign every
 * prompt with whoever pressed Save. Browsers send a textarea's line breaks as CRLF, which would
 * make every multi-line prompt look changed.
 */
function changedPrompts(form: Record<string, unknown>, current: AgentPromptView[]): AgentPromptChanges {
  const changes: AgentPromptChanges = {};
  for (const view of current) {
    const field = form[`prompt.${view.role}`];
    if (field === undefined) continue;
    const text = String(field).replace(/\r\n/g, "\n").trim();
    if (text !== (view.own?.text ?? "")) changes[view.role] = text || null;
  }
  return changes;
}

function changedModels(form: Record<string, unknown>, saved: Map<AgentRole, SavedAgentModel>): AgentModelChanges {
  const changes: AgentModelChanges = {};
  for (const role of agentRole.options) {
    const field = form[`model.${role}`];
    if (field === undefined) continue;
    const model = String(field).trim();
    if (model !== (saved.get(role)?.model ?? "")) changes[role] = model || null;
  }
  return changes;
}

/** A model whose provider has no key here would be saved and then never used: refuse it while the admin is looking. */
function modelWithNoCredentials(changes: AgentModelChanges): string | null {
  for (const [role, model] of Object.entries(changes) as [AgentRole, string | null][]) {
    if (model && !describeRoleModel(role, model)?.saved) {
      return `${model} names a provider with no credentials on this server, so ${role} was left as it was.`;
    }
  }
  return null;
}

async function agentModelViews(saved: Map<AgentRole, SavedAgentModel>): Promise<Map<AgentRole, AgentModelView>> {
  const views = await Promise.all(
    agentRole.options.map(async (role): Promise<[AgentRole, AgentModelView]> => {
      const model = saved.get(role)?.model;
      return [role, { saved: saved.get(role) ?? null, inForce: describeRoleModel(role, model), left: await quotaLeft(role, model) }];
    }),
  );
  return new Map(views);
}

agentPromptRoutes.get("/admin/agents", async (c) => {
  const user = c.get("user")!;
  if (!isAdmin(user)) {
    return c.html(
      layout("Not found", html`<p><a class="back" href="/">← Projects</a></p><div class="empty">Not found.</div>`, user),
      404,
    );
  }
  const notice = c.req.query("error");
  const views = await getAgentPrompts(null);
  const models = isLlmEnabled() ? await agentModelViews(await getAgentModels()) : null;
  const body = html`
    <p><a class="back" href="/">← Projects</a></p>
    <h1>Agents</h1>
    <p class="sub">
      Each agent judges by the default written in the code. A text saved here replaces that default for every
      project; each project can then add its own under its Settings, never take this away. The format each agent
      answers in is fixed and goes after all of it.
    </p>
    <p class="sub">
      The model each one asks for is <code>model</code>, or <code>provider:model</code> to send it elsewhere. One saved
      here wins over this server's environment — <code>CORTEX_MODEL_&lt;ROLE&gt;</code>, or <code>LLM_MODEL</code> for
      all of them — from the next call on; an empty field gives the agent back to it. The keys stay in the environment.
    </p>
    ${adminTabs("agents")}
    ${notice ? html`<div class="warn">${notice}</div>` : ""}
    ${models ? agentsAtAGlance(models) : ""}
    ${rootAgentPromptsPanel(views, models)}`;
  return c.html(layout("Agents", body, { user, active: "admin" }));
});

agentPromptRoutes.post("/admin/agents", async (c) => {
  const user = c.get("user")!;
  if (!isAdmin(user)) return c.redirect("/admin/agents");
  const refuse = (error: string) => c.redirect(`/admin/agents?error=${encodeURIComponent(error)}`);
  const form = await c.req.parseBody();
  const prompts = changedPrompts(form, await getAgentPrompts(null));
  if (!agentPromptChanges.safeParse(prompts).success) return refuse(TOO_LONG);
  const models = changedModels(form, await getAgentModels());
  const noCredentials = modelWithNoCredentials(models);
  if (noCredentials) return refuse(noCredentials);
  try {
    await setAgentModels(models, user);
  } catch (e) {
    if (e instanceof InvalidAgentModelError) return refuse(e.message);
    throw e;
  }
  await setAgentPrompts(null, prompts, user);
  return c.redirect("/admin/agents");
});

agentPromptRoutes.post("/p/:slug/settings/agent-prompts", async (c) => {
  const user = c.get("user")!;
  const res = await requireProjectPage(c, c.req.param("slug"));
  if (res instanceof Response) return res;
  const slug = res.project.slug!;
  if (!res.manager) return c.redirect(`/p/${slug}/settings`);
  const changes = changedPrompts(await c.req.parseBody(), await getAgentPrompts(slug));
  if (!agentPromptChanges.safeParse(changes).success) {
    return c.redirect(`/p/${slug}/settings?error=${encodeURIComponent(TOO_LONG)}`);
  }
  await setAgentPrompts(slug, changes, user);
  return c.redirect(`/p/${slug}/settings`);
});

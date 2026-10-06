import { Hono } from "hono";
import { html } from "hono/html";
import { getAgentPrompts, isAdmin, setAgentPrompts, type AgentPromptView } from "@cortex/core";
import { AGENT_PROMPT_MAX_LENGTH, agentPromptChanges, type AgentPromptChanges } from "@cortex/shared";
import { layout } from "../views/layout.js";
import { adminTabs } from "../views/admin-nav.js";
import { rootAgentPromptsPanel } from "../views/agent-prompts.js";
import { requireProjectPage } from "../middleware/access.js";
import type { WebEnv } from "../middleware/session.js";

/**
 * What the agents are told (ADR-0088): root under the admin area, because it is about the whole
 * installation, and each project's under its Settings, next to what it keeps.
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

agentPromptRoutes.get("/admin/agents", async (c) => {
  const user = c.get("user")!;
  if (!isAdmin(user)) {
    return c.html(
      layout("Not found", html`<p><a class="back" href="/">← Projects</a></p><div class="empty">Not found.</div>`, user),
      404,
    );
  }
  const notice = c.req.query("error");
  const body = html`
    <p><a class="back" href="/">← Projects</a></p>
    <h1>What the agents are told</h1>
    <p class="sub">
      Each agent judges by the default written in the code. A text saved here replaces that default for every
      project; each project can then add its own under its Settings, never take this away. The format each agent
      answers in is fixed and goes after all of it.
    </p>
    ${adminTabs("agents")}
    ${notice ? html`<div class="warn">${notice}</div>` : ""}
    ${rootAgentPromptsPanel(await getAgentPrompts(null))}`;
  return c.html(layout("Agents", body, { user, active: "admin" }));
});

agentPromptRoutes.post("/admin/agents", async (c) => {
  const user = c.get("user")!;
  if (!isAdmin(user)) return c.redirect("/admin/agents");
  const changes = changedPrompts(await c.req.parseBody(), await getAgentPrompts(null));
  if (!agentPromptChanges.safeParse(changes).success) {
    return c.redirect(`/admin/agents?error=${encodeURIComponent(TOO_LONG)}`);
  }
  await setAgentPrompts(null, changes, user);
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

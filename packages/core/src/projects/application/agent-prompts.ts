import { agentPromptChanges, agentRole, scrub, type AgentPromptChanges, type AgentRole } from "@cortex/shared";
import { isAdmin } from "../../auth/domain/auth.js";
import type { SessionUser } from "../../auth/domain/session-user.js";
import { chainOf, viewOf, type AgentPromptChain, type AgentPromptView } from "../domain/agent-prompts.js";
import { findProjectBySlug, requireManager } from "./projects.js";
import { port } from "../../composition.js";

export async function agentPromptChain(role: AgentRole, projectId: string | null): Promise<AgentPromptChain> {
  return chainOf(role, await port("agentPrompts").chain(projectId));
}

/** Root's prompts when `slug` is null; otherwise the project's own, and what it inherits. */
export async function getAgentPrompts(slug: string | null): Promise<AgentPromptView[]> {
  let projectId: string | null = null;
  if (slug !== null) {
    const project = await findProjectBySlug(slug);
    if (!project) throw new Error(`Project "${slug}" not found.`);
    projectId = project.id;
  }
  const prompts = await port("agentPrompts").chain(projectId);
  return agentRole.options.map((role) => viewOf(role, prompts, slug === null ? "root" : "project"));
}

export class NotAnAdminError extends Error {
  constructor() {
    super("Only an administrator can change what every project inherits.");
    this.name = "NotAnAdminError";
  }
}

/** Root's when `slug` is null, which only an admin may change; a project's, which its managers may. */
export async function setAgentPrompts(
  slug: string | null,
  changes: AgentPromptChanges,
  actor: SessionUser | null,
): Promise<void> {
  const parsed = agentPromptChanges.parse(changes);
  const projectId = slug === null ? rootIfAdmin(actor) : (await requireManager(slug, actor)).id;
  const repository = port("agentPrompts");
  for (const [role, text] of Object.entries(parsed) as [AgentRole, string | null][]) {
    await repository.set(projectId, role, text ? scrub(text) : null, actor!.email);
  }
}

function rootIfAdmin(actor: SessionUser | null): null {
  if (!isAdmin(actor)) throw new NotAnAdminError();
  return null;
}

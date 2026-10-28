import { agentRole, scrub, type AgentRole } from "@cortex/shared";
import { isAdmin } from "../../auth/domain/auth.js";
import type { SessionUser } from "../../auth/domain/session-user.js";
import { AGENT_MODEL_MAX_LENGTH, isModelSpec, type AgentModelChanges, type SavedAgentModel } from "../domain/agent-models.js";
import { NotAnAdminError } from "./agent-prompts.js";
import { port } from "../../composition.js";

export async function getAgentModels(): Promise<Map<AgentRole, SavedAgentModel>> {
  return new Map((await port("agentModels").all()).map((saved) => [saved.role, saved]));
}

/** Read on every call rather than once per process: a model saved from the web reaches the API, the MCP and the nightly pass alike. */
export async function agentModelFor(role: AgentRole): Promise<string | null> {
  return (await getAgentModels()).get(role)?.model ?? null;
}

export class InvalidAgentModelError extends Error {
  constructor(role: AgentRole) {
    super(`The model for ${role} must be one word of at most ${AGENT_MODEL_MAX_LENGTH} characters: \`model\` or \`provider:model\`.`);
    this.name = "InvalidAgentModelError";
  }
}

/** Only an admin: the model is the installation's, like root's prompts. */
export async function setAgentModels(changes: AgentModelChanges, actor: SessionUser | null): Promise<void> {
  if (!isAdmin(actor)) throw new NotAnAdminError();
  const cleaned = Object.entries(changes)
    .filter((entry): entry is [AgentRole, string | null] => agentRole.safeParse(entry[0]).success)
    .map(([role, model]) => [role, model?.trim() ? scrub(model.trim()) : null] as const);
  for (const [role, model] of cleaned) if (model !== null && !isModelSpec(model)) throw new InvalidAgentModelError(role);
  const repository = port("agentModels");
  for (const [role, model] of cleaned) await repository.set(role, model, actor!.email);
}

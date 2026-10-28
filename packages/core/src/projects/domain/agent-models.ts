import type { AgentRole } from "@cortex/shared";

/** `model` reads like `CORTEX_MODEL_<ROLE>`: `model`, or `provider:model` to route the role elsewhere. */
export interface SavedAgentModel {
  role: AgentRole;
  model: string;
  updatedBy: string;
  updatedAt: Date;
}

/** A role left out is not touched; `null` or an empty text gives the role back to the environment. */
export type AgentModelChanges = Partial<Record<AgentRole, string | null>>;

export const AGENT_MODEL_MAX_LENGTH = 200;

export function isModelSpec(model: string): boolean {
  return model.length <= AGENT_MODEL_MAX_LENGTH && /^\S+$/.test(model);
}

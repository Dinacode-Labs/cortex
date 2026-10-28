import type { AgentRole } from "@cortex/shared";
import type { SavedAgentModel } from "./agent-models.js";

export interface AgentModelRepository {
  all(): Promise<SavedAgentModel[]>;
  /** `null` removes the role's model. */
  set(role: AgentRole, model: string | null, updatedBy: string): Promise<void>;
}

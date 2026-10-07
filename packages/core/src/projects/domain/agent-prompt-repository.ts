import type { AgentRole } from "@cortex/shared";
import type { ChainedAgentPrompt } from "./agent-prompts.js";

export interface AgentPromptRepository {
  /** Root's prompts and those of the project and every ancestor; with no project, root's alone. */
  chain(projectId: string | null): Promise<ChainedAgentPrompt[]>;
  /** `null` text removes the prompt. A null project is root. */
  set(projectId: string | null, role: AgentRole, text: string | null, updatedBy: string): Promise<void>;
}

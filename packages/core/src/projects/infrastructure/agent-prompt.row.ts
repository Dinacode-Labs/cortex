import type { Row } from "@cortex/database";
import type { ChainedAgentPrompt } from "../domain/agent-prompts.js";

export function rowToChainedAgentPrompt(row: Row): ChainedAgentPrompt {
  return {
    role: row.role,
    text: row.prompt,
    updatedBy: row.updated_by,
    updatedAt: row.updated_at,
    depth: row.depth ?? null,
  };
}

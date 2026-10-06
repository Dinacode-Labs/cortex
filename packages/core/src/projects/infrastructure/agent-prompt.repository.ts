import { getSql, type Row, type Sql } from "@cortex/database";
import type { AgentRole } from "@cortex/shared";
import type { ChainedAgentPrompt } from "../domain/agent-prompts.js";
import type { AgentPromptRepository } from "../domain/agent-prompt-repository.js";
import { rowToChainedAgentPrompt } from "./agent-prompt.row.js";

export class PgAgentPromptRepository implements AgentPromptRepository {
  constructor(private readonly sql: Sql = getSql()) {}

  async chain(projectId: string | null): Promise<ChainedAgentPrompt[]> {
    const rows = (await this.sql`
      WITH RECURSIVE chain AS (
        SELECT id, parent_id, 0 AS depth FROM entities WHERE id = ${projectId}
        UNION ALL
        SELECT e.id, e.parent_id, c.depth + 1 FROM entities e JOIN chain c ON e.id = c.parent_id
      )
      SELECT a.role, a.prompt, a.updated_by, a.updated_at, c.depth
        FROM agent_prompts a
        LEFT JOIN chain c ON c.id = a.project_id
       WHERE a.project_id IS NULL OR c.id IS NOT NULL
    `) as unknown as Row[];
    return rows.map(rowToChainedAgentPrompt);
  }

  async set(projectId: string | null, role: AgentRole, text: string | null, updatedBy: string): Promise<void> {
    if (text === null) {
      await this.sql`DELETE FROM agent_prompts WHERE project_id IS NOT DISTINCT FROM ${projectId} AND role = ${role}`;
      return;
    }
    await this.sql`
      INSERT INTO agent_prompts (project_id, role, prompt, updated_by)
      VALUES (${projectId}, ${role}, ${text}, ${updatedBy})
      ON CONFLICT (project_id, role) DO UPDATE
        SET prompt = EXCLUDED.prompt, updated_by = EXCLUDED.updated_by, updated_at = now()
    `;
  }
}

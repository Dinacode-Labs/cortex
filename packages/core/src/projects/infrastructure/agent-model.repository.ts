import { getSql, type Row, type Sql } from "@cortex/database";
import type { AgentRole } from "@cortex/shared";
import type { SavedAgentModel } from "../domain/agent-models.js";
import type { AgentModelRepository } from "../domain/agent-model-repository.js";
import { rowToSavedAgentModel } from "./agent-model.row.js";

export class PgAgentModelRepository implements AgentModelRepository {
  constructor(private readonly sql: Sql = getSql()) {}

  async all(): Promise<SavedAgentModel[]> {
    const rows = (await this.sql`SELECT role, model, updated_by, updated_at FROM agent_models`) as unknown as Row[];
    return rows.map(rowToSavedAgentModel);
  }

  async set(role: AgentRole, model: string | null, updatedBy: string): Promise<void> {
    if (model === null) {
      await this.sql`DELETE FROM agent_models WHERE role = ${role}`;
      return;
    }
    await this.sql`
      INSERT INTO agent_models (role, model, updated_by)
      VALUES (${role}, ${model}, ${updatedBy})
      ON CONFLICT (role) DO UPDATE
        SET model = EXCLUDED.model, updated_by = EXCLUDED.updated_by, updated_at = now()
    `;
  }
}

import type { Row } from "@cortex/database";
import type { SavedAgentModel } from "../domain/agent-models.js";

export function rowToSavedAgentModel(row: Row): SavedAgentModel {
  return {
    role: row.role,
    model: row.model,
    updatedBy: row.updated_by,
    updatedAt: row.updated_at,
  };
}

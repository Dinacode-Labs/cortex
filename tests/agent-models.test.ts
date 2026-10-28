import { describe, it, expect, afterEach, beforeEach } from "vitest";
import type { AgentRole } from "../packages/shared/src/index";
import {
  agentModelFor,
  configureCore,
  InvalidAgentModelError,
  NotAnAdminError,
  resetCore,
  setAgentModels,
} from "../packages/core/src/index";
import type { SavedAgentModel } from "../packages/core/src/projects/domain/agent-models";
import type { AgentModelRepository } from "../packages/core/src/projects/domain/agent-model-repository";

const ADMIN = { email: "admin@example.com" };

function inMemoryModels(rows: SavedAgentModel[]): AgentModelRepository {
  return {
    all: async () => rows,
    set: async (role: AgentRole, model: string | null, updatedBy: string) => {
      const at = rows.findIndex((row) => row.role === role);
      if (at >= 0) rows.splice(at, 1);
      if (model !== null) rows.push({ role, model, updatedBy, updatedAt: new Date() });
    },
  };
}

/**
 * The model a role runs on is the installation's (ADR-0101): saved by an admin, like root's
 * prompts, and checked before it is written, because a model with a space or a pasted key in it
 * would reach every call that role makes.
 */
describe("the model an admin saves for a role", () => {
  let rows: SavedAgentModel[];
  const previousAdmins = process.env.CORTEX_ADMIN_EMAIL;

  beforeEach(() => {
    rows = [];
    process.env.CORTEX_ADMIN_EMAIL = ADMIN.email;
    configureCore({ agentModels: inMemoryModels(rows) });
  });
  afterEach(() => {
    resetCore();
    process.env.CORTEX_ADMIN_EMAIL = previousAdmins;
  });

  it("is saved by an admin only, and signed with who saved it", async () => {
    await expect(setAgentModels({ judge: "judge-model" }, { email: "someone@example.com" })).rejects.toThrow(NotAnAdminError);
    await expect(setAgentModels({ judge: "judge-model" }, null)).rejects.toThrow(NotAnAdminError);
    expect(rows).toEqual([]);

    await setAgentModels({ judge: " openrouter:x-ai/grok-4.5 " }, ADMIN);
    expect(rows).toMatchObject([{ role: "judge", model: "openrouter:x-ai/grok-4.5", updatedBy: ADMIN.email }]);
    expect(await agentModelFor("judge")).toBe("openrouter:x-ai/grok-4.5");
    expect(await agentModelFor("editor")).toBeNull();
  });

  it("gives the role back to the environment on an empty text", async () => {
    await setAgentModels({ judge: "judge-model", editor: "editor-model" }, ADMIN);
    await setAgentModels({ judge: "", editor: null }, ADMIN);

    expect(rows).toEqual([]);
  });

  it("refuses the whole change when one model is not one word, and writes none of it", async () => {
    await expect(setAgentModels({ judge: "judge-model", editor: "two words" }, ADMIN)).rejects.toThrow(InvalidAgentModelError);
    await expect(setAgentModels({ editor: "x".repeat(201) }, ADMIN)).rejects.toThrow(InvalidAgentModelError);

    expect(rows).toEqual([]);
  });

  it("ignores a role that does not exist", async () => {
    await setAgentModels({ planner: "plan-model" } as never, ADMIN);

    expect(rows).toEqual([]);
  });
});

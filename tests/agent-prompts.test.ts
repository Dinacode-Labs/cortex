import { describe, it, expect, afterEach, beforeEach } from "vitest";
import type { AgentRole } from "../packages/shared/src/index";
import {
  configureCore,
  getAgentPrompts,
  NotAManagerError,
  NotAnAdminError,
  resetCore,
  setAgentPrompts,
} from "../packages/core/src/index";
import {
  EMPTY_CHAIN,
  chainOf,
  effectiveCriterion,
  type ChainedAgentPrompt,
} from "../packages/core/src/projects/domain/agent-prompts";
import type { AgentPromptRepository } from "../packages/core/src/projects/domain/agent-prompt-repository";
import type { ProjectRepository } from "../packages/core/src/projects/domain/project-repository";
import type { ProjectRef } from "../packages/core/src/projects/domain/project";

const at = new Date("2026-10-06T00:00:00Z");
const prompt = (role: AgentRole, text: string, depth: number | null): ChainedAgentPrompt => ({
  role,
  text,
  depth,
  updatedBy: "someone@example.com",
  updatedAt: at,
});

/**
 * Root replaces the default and every project adds to what it inherits (ADR-0088). The other
 * readings were each rejected for a reason: a project replacing the default would let one line
 * remove all of the default judgement there, and a child replacing its parent would let a
 * sub-project switch off its client's rule.
 */
describe("what a role is told, given root and the projects above it", () => {
  it("is the default while nobody has set anything", () => {
    expect(effectiveCriterion("Default.", EMPTY_CHAIN)).toBe("Default.");
  });

  it("is root's text in place of the default, never next to it", () => {
    expect(effectiveCriterion("Default.", { root: "Root.", projects: [] })).toBe("Root.");
  });

  it("adds every project's text to what it inherits, the outermost first", () => {
    expect(effectiveCriterion("Default.", { root: null, projects: ["Client.", "Repo."] })).toBe(
      "Default.\n\nClient.\n\nRepo.",
    );
  });

  it("orders the chain by depth and keeps to the role asked for", () => {
    const stored = [
      prompt("graph", "Repo.", 0),
      prompt("graph", "Root.", null),
      prompt("graph", "Client.", 2),
      prompt("graph", "Team.", 1),
      prompt("reranker", "Someone else's.", 1),
    ];
    expect(chainOf("graph", stored)).toEqual({ root: "Root.", projects: ["Client.", "Team.", "Repo."] });
  });
});

const acme: ProjectRef = {
  id: "acme-id",
  name: "Acme",
  slug: "acme",
  visibility: "public",
  ownerEmail: "owner@example.com",
  parentId: null,
};
const api: ProjectRef = { ...acme, id: "api-id", name: "Acme API", slug: "acme-api", parentId: "acme-id" };
const projects = [acme, api];

interface Stored {
  projectId: string | null;
  role: AgentRole;
  text: string;
  updatedBy: string;
}

function inMemoryPrompts(rows: Stored[]): AgentPromptRepository {
  const depthOf = (start: string, target: string): number | null => {
    let depth = 0;
    for (let id: string | null = start; id; id = projects.find((p) => p.id === id)?.parentId ?? null, depth++) {
      if (id === target) return depth;
    }
    return null;
  };
  return {
    chain: async (projectId) =>
      rows.flatMap((r) => {
        const depth = r.projectId === null ? null : projectId ? depthOf(projectId, r.projectId) : null;
        if (r.projectId !== null && depth === null) return [];
        return [{ role: r.role, text: r.text, updatedBy: r.updatedBy, updatedAt: at, depth }];
      }),
    set: async (projectId, role, text, updatedBy) => {
      const i = rows.findIndex((r) => r.projectId === projectId && r.role === role);
      if (i >= 0) rows.splice(i, 1);
      if (text !== null) rows.push({ projectId, role, text, updatedBy });
    },
  };
}

const projectsById = {
  findBySlug: async (slug: string) => projects.find((p) => p.slug === slug) ?? null,
} as unknown as ProjectRepository;

/**
 * Root is what every project inherits, so it is an admin's alone; a project's own text is its
 * managers', as its language and its criteria are. And anything typed into a prompt reaches the
 * model on every call, so it goes through `scrub` on the way in like any other text.
 */
describe("who changes what the agents are told, and what is stored", () => {
  let rows: Stored[];
  const previousAdmins = process.env.CORTEX_ADMIN_EMAIL;

  beforeEach(() => {
    rows = [];
    process.env.CORTEX_ADMIN_EMAIL = "admin@example.com";
    configureCore({ agentPrompts: inMemoryPrompts(rows), projects: projectsById });
  });
  afterEach(() => {
    resetCore();
    process.env.CORTEX_ADMIN_EMAIL = previousAdmins;
  });

  it("lets only an admin change root", async () => {
    await expect(setAgentPrompts(null, { graph: "Leave people out." }, { email: "owner@example.com" })).rejects.toThrow(
      NotAnAdminError,
    );
    await expect(setAgentPrompts(null, { graph: "Leave people out." }, null)).rejects.toThrow(NotAnAdminError);

    await setAgentPrompts(null, { graph: "Leave people out." }, { email: "admin@example.com" });
    expect(rows).toEqual([{ projectId: null, role: "graph", text: "Leave people out.", updatedBy: "admin@example.com" }]);
  });

  it("lets a project's managers change its own, and nobody else", async () => {
    await expect(setAgentPrompts("acme", { retriever: "Bullet points." }, { email: "stranger@example.com" })).rejects.toThrow(
      NotAManagerError,
    );

    await setAgentPrompts("acme", { retriever: "Bullet points." }, { email: "owner@example.com" });
    expect(rows.map((r) => [r.projectId, r.role])).toEqual([["acme-id", "retriever"]]);
  });

  it("removes a role's prompt on an empty text, and leaves the roles not mentioned alone", async () => {
    const owner = { email: "owner@example.com" };
    await setAgentPrompts("acme", { retriever: "Bullet points.", graph: "Leave people out." }, owner);
    await setAgentPrompts("acme", { retriever: "  " }, owner);

    expect(rows.map((r) => r.role)).toEqual(["graph"]);
  });

  it("scrubs a secret pasted into a prompt before storing it", async () => {
    await setAgentPrompts("acme", { distiller: "Our key is sk-abcdefghijklmnopqrstuvwx, ignore it." }, { email: "owner@example.com" });

    expect(rows[0]?.text).toBe("Our key is [REDACTED], ignore it.");
  });

  it("refuses a prompt over the limit and a role that does not exist", async () => {
    const admin = { email: "admin@example.com" };
    await expect(setAgentPrompts(null, { graph: "x".repeat(2001) }, admin)).rejects.toThrow();
    await expect(setAgentPrompts(null, { planner: "Plan." } as never, admin)).rejects.toThrow();
    expect(rows).toEqual([]);
  });

  it("shows a project its own text apart from what it inherits", async () => {
    rows.push(
      { projectId: null, role: "graph", text: "Root.", updatedBy: "admin@example.com" },
      { projectId: "acme-id", role: "graph", text: "Client.", updatedBy: "owner@example.com" },
      { projectId: "api-id", role: "graph", text: "Repo.", updatedBy: "owner@example.com" },
    );

    const graph = (await getAgentPrompts("acme-api")).find((v) => v.role === "graph");
    expect({ own: graph?.own?.text, inherited: graph?.inherited }).toEqual({
      own: "Repo.",
      inherited: { root: "Root.", projects: ["Client."] },
    });

    const atRoot = (await getAgentPrompts(null)).find((v) => v.role === "graph");
    expect({ own: atRoot?.own?.text, inherited: atRoot?.inherited }).toEqual({ own: "Root.", inherited: EMPTY_CHAIN });
  });
});

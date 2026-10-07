import type { AgentRole } from "@cortex/shared";

export interface AgentPrompt {
  role: AgentRole;
  text: string;
  updatedBy: string;
  updatedAt: Date;
}

/** `depth` 0 is the project itself, 1 its parent, and so on; `null` is root. */
export interface ChainedAgentPrompt extends AgentPrompt {
  depth: number | null;
}

export interface AgentPromptChain {
  root: string | null;
  /** The outermost ancestor first, the project itself last. */
  projects: string[];
}

export interface AgentPromptView {
  role: AgentRole;
  level: "root" | "project";
  own: AgentPrompt | null;
  inherited: AgentPromptChain;
}

export const EMPTY_CHAIN: AgentPromptChain = { root: null, projects: [] };

export function chainOf(role: AgentRole, prompts: ChainedAgentPrompt[]): AgentPromptChain {
  const ofRole = prompts.filter((p) => p.role === role);
  return {
    root: ofRole.find((p) => p.depth === null)?.text ?? null,
    projects: ofRole
      .filter((p): p is ChainedAgentPrompt & { depth: number } => p.depth !== null)
      .sort((a, b) => b.depth - a.depth)
      .map((p) => p.text),
  };
}

/**
 * Root's text replaces the default and every project's is added to what it inherits (ADR-0088):
 * only an admin can take the default judgement away, and only for the whole instance.
 */
export function effectiveCriterion(defaultCriterion: string, chain: AgentPromptChain): string {
  return [chain.root ?? defaultCriterion, ...chain.projects].join("\n\n");
}

export function viewOf(role: AgentRole, prompts: ChainedAgentPrompt[], level: "root" | "project"): AgentPromptView {
  const atLevel = level === "root" ? null : 0;
  const own = prompts.find((p) => p.role === role && p.depth === atLevel) ?? null;
  const above = level === "root" ? [] : prompts.filter((p) => p.depth !== 0);
  return {
    role,
    level,
    own: own && { role: own.role, text: own.text, updatedBy: own.updatedBy, updatedAt: own.updatedAt },
    inherited: chainOf(role, above),
  };
}

/** The chain a call made at this level runs with: what it inherits, and its own text. */
export function chainAt(view: AgentPromptView): AgentPromptChain {
  const own = view.own?.text ?? null;
  if (view.level === "root") return { root: own, projects: [] };
  return { root: view.inherited.root, projects: own ? [...view.inherited.projects, own] : view.inherited.projects };
}

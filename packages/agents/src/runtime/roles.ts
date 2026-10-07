import type { Language } from "@cortex/shared";

export const AGENT_ROLES = ["classifier", "graph", "reranker", "retriever", "distiller", "merger", "reconciler"] as const;
export type AgentRole = (typeof AGENT_ROLES)[number];

/**
 * A role's system prompt is two parts kept apart on purpose (ADR-0088): the criterion it judges
 * by, which an admin or a project may rewrite, and the contract the code reading its answer
 * depends on, which nobody can, so a rewritten criterion never breaks the parse.
 */
export interface RoleInstructions {
  criterion: string;
  contract: (language: Language) => string;
}

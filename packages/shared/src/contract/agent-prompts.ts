import { z } from "zod";

export const agentRole = z.enum(["classifier", "graph", "reranker", "retriever", "distiller", "merger", "reconciler"]);
export type AgentRole = z.infer<typeof agentRole>;

/** The whole chain travels with every call, and the reranker makes one on every search. */
export const AGENT_PROMPT_MAX_LENGTH = 2000;

/** A role left out is not touched; `null` or an empty text removes that role's prompt. */
export const agentPromptChanges = z.record(agentRole, z.string().trim().max(AGENT_PROMPT_MAX_LENGTH).nullable());
export type AgentPromptChanges = z.infer<typeof agentPromptChanges>;

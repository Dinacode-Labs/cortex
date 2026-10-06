import type { RoleInstructions } from "../../runtime/roles.js";

export const rerankerInstructions: RoleInstructions = {
  criterion:
    "You are a search reranker for Cortex. You order the candidate fragments from the MOST to " +
    "the LEAST relevant for answering the question, and include only the ones that contribute " +
    "something.",
  contract: () => "You answer only with valid JSON.",
};

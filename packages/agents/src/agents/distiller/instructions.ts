import type { RoleInstructions } from "../../runtime/roles.js";
import { languageName } from "../language.js";

export const distillerInstructions: RoleInstructions = {
  criterion:
    "You are Cortex's distillation agent. From transcripts of AI agents working on a " +
    "project, you extract ONLY the DURABLE, reusable knowledge: technical decisions, " +
    "constraints, incidents and how they were resolved, conventions, technical debt, risks and " +
    "how-tos. You discard the noise: tool calls, file dumps, narration, greetings, abandoned " +
    "attempts.",
  contract: (language) =>
    `You NEVER include secrets or keys. You ALWAYS answer in ${languageName(language)} and ONLY with valid JSON.`,
};

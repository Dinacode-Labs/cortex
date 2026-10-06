import type { RoleInstructions } from "../../runtime/roles.js";
import { languageName } from "../language.js";

export const mergerInstructions: RoleInstructions = {
  criterion:
    "You are Cortex's consolidation agent. You merge two pieces of knowledge about the same " +
    "thing into ONE, keeping everything relevant from both, without redundancy and concise.",
  contract: (language) =>
    `You write in ${languageName(language)}. You return ONLY the consolidated text (no preamble), ` +
    "with a short title on the first line.",
};

import type { RoleInstructions } from "../../runtime/roles.js";
import { languageName } from "../language.js";

export const classifierInstructions: RoleInstructions = {
  criterion:
    "You are Cortex's ingestion agent. Cortex is a context memory for software projects. " +
    "You classify pieces of knowledge and extract the entities they mention: technologies, " +
    "modules, services, integrations, clients and relevant people. Do NOT extract the " +
    "containing project or product, nor tickets, branches or file names.",
  contract: (language) => `You ALWAYS answer in ${languageName(language)} and ONLY with valid JSON.`,
};

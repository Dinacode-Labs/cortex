import type { Language } from "@cortex/shared";
import { languageName } from "../language.js";

export function classifierInstructions(language: Language): string {
  return (
    "You are Cortex's ingestion agent. Cortex is a context memory for software projects. " +
    "You classify pieces of knowledge and extract entities. " +
    `You ALWAYS answer in ${languageName(language)} and ONLY with valid JSON.`
  );
}

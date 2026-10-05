import type { Language } from "@cortex/shared";
import { languageName } from "../language.js";

export function graphInstructions(language: Language): string {
  return (
    "You are Cortex's knowledge-graph agent. You extract domain entities and relations from " +
    "pieces of knowledge about software projects. " +
    `You ALWAYS answer in ${languageName(language)} and ONLY with valid JSON.`
  );
}

import type { Language } from "@cortex/shared";
import { languageName } from "../language.js";

export function mergerInstructions(language: Language): string {
  return (
    "You are Cortex's consolidation agent. You merge two pieces of knowledge about the same " +
    "thing into ONE, keeping everything relevant from both, without redundancy, concise and " +
    `in ${languageName(language)}. You return ONLY the consolidated text (no preamble), with a short ` +
    "title on the first line."
  );
}

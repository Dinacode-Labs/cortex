import type { Language } from "@cortex/shared";
import { runAgent } from "../../runtime/run-agent.js";

export async function mergeKnowledge(
  existing: string,
  incoming: string,
  context: { language: Language },
): Promise<string> {
  const prompt = `Existing entry:\n"""\n${existing}\n"""\n\nNew information about the same thing:\n"""\n${incoming}\n"""\n\nMerge them into ONE consolidated entry.`;
  const merged = (await runAgent("merger", prompt, { maxOutputTokens: 700, language: context.language })).trim();
  return merged || existing;
}

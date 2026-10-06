import type { Language } from "@cortex/shared";
import { runAgent } from "../../runtime/run-agent.js";
import { mergerPrompt } from "./prompt.js";

export async function mergeKnowledge(
  existing: string,
  incoming: string,
  context: { language: Language },
): Promise<string> {
  const prompt = mergerPrompt(existing, incoming);
  const merged = (await runAgent("merger", prompt, { maxOutputTokens: 700, language: context.language })).trim();
  return merged || existing;
}

import type { Language } from "@cortex/shared";
import { runAgent } from "../../runtime/run-agent.js";
import { mergerPrompt } from "./prompt.js";

export async function mergeKnowledge(
  existing: string,
  incoming: string,
  context: { language: Language; projectId: string | null },
): Promise<string> {
  const prompt = mergerPrompt(existing, incoming);
  const { language, projectId } = context;
  const merged = (await runAgent("merger", prompt, { maxOutputTokens: 700, language, projectId })).trim();
  return merged || existing;
}

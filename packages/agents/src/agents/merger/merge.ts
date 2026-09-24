import { runAgent } from "../../runtime/run-agent.js";

export async function mergeKnowledge(existing: string, incoming: string): Promise<string> {
  const prompt = `Existing entry:\n"""\n${existing}\n"""\n\nNew information about the same thing:\n"""\n${incoming}\n"""\n\nMerge them into ONE consolidated entry.`;
  const merged = (await runAgent("merger", prompt, { maxOutputTokens: 700 })).trim();
  return merged || existing;
}

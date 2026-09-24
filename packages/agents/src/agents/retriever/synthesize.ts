import { getAgent } from "../../runtime/registry.js";
import { runAgent } from "../../runtime/run-agent.js";
import { retrieverPrompt, type ContextSnippet } from "./prompt.js";

export type { ContextSnippet };

export async function synthesizeContextAnswer(
  question: string,
  snippets: ContextSnippet[],
): Promise<string | null> {
  if (!getAgent("retriever") || snippets.length === 0) return null;

  try {
    return await runAgent("retriever", retrieverPrompt(question, snippets), { maxOutputTokens: 900 });
  } catch (e) {
    console.error("[agents] synthesizeContextAnswer failed:", (e as Error).message);
    return null;
  }
}

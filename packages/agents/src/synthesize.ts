import { getAgent, runAgent } from "./mastra.js";

/**
 * Retrieval agent (section 7): it synthesises a prose answer grounded in the context retrieved
 * from Cortex. Implemented as a Mastra Agent (role "retriever", see mastra.ts).
 */

export interface ContextSnippet {
  title: string;
  summary: string;
  type: string;
}

/** Synthesises an answer from context fragments. null when there is no LLM. */
export async function synthesizeContextAnswer(
  question: string,
  snippets: ContextSnippet[],
): Promise<string | null> {
  if (!getAgent("retriever") || snippets.length === 0) return null;

  const context = snippets
    .map((s, i) => `${i + 1}. [${s.type}] ${s.title}: ${s.summary}`)
    .join("\n");
  const prompt = `The developer's question: ${question}

Context retrieved from Cortex:
${context}

Answer the question based only on the context above. Highlight risks, decisions in force and
constraints when they are relevant. When information is missing, say so.`;

  try {
    return await runAgent("retriever", prompt, { maxOutputTokens: 900 });
  } catch (e) {
    console.error("[agents] synthesizeContextAnswer failed:", (e as Error).message);
    return null;
  }
}

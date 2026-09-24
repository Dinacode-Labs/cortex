import { searchContext, type SearchHit } from "@cortex/core";
import { synthesizeContextAnswer } from "../agents/retriever/synthesize.js";

/**
 * Shared orchestration of "ask the context" (section 7): it retrieves the most relevant hits
 * and synthesises a grounded answer with the retrieval agent. The web (GET /ask) and the
 * `ask_project_context` MCP tool both use it -- both did exactly this (limit 6, the same
 * snippets); each consumer renders its own output.
 */

export interface AskResult {
  /** null when no LLM is configured or synthesis fails (the caller decides the fallback). */
  answer: string | null;
  hits: SearchHit[];
}

export async function askProjectContext(
  question: string,
  project?: string,
  limit = 6,
  opts?: { restrictToAccessibleOf?: string | null },
): Promise<AskResult> {
  // Security scoping: propagated as is to searchContext (see its docs). Without `opts` it is
  // a trusted call (it searches everything); with it, it restricts to accessible projects.
  const hits = await searchContext({ query: question, project, limit }, opts);
  const answer = await synthesizeContextAnswer(
    question,
    hits.map((h) => ({ title: h.entry.title, summary: h.entry.summary ?? h.entry.content, type: h.entry.type })),
  );
  return { answer, hits };
}

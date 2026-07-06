import { searchContext, type SearchHit } from "@cortex/core";
import { synthesizeContextAnswer } from "./synthesize.js";

/**
 * Orquestación compartida de «preguntar al contexto» (§7): recupera los hits más
 * relevantes y sintetiza una respuesta fundamentada con el agente de recuperación.
 * La usan la web (GET /ask) y la tool MCP `ask_project_context` — ambas hacían
 * exactamente esto (limit 6, mismos snippets); cada consumidor renderiza lo suyo.
 */

export interface AskResult {
  /** null si no hay LLM configurado o la síntesis falla (el caller decide el fallback). */
  answer: string | null;
  hits: SearchHit[];
}

export async function askProjectContext(
  question: string,
  project?: string,
  limit = 6,
  opts?: { restrictToAccessibleOf?: string | null },
): Promise<AskResult> {
  // Scoping de seguridad: se propaga tal cual a searchContext (ver su doc). Sin `opts`
  // = llamada confiable (busca en todo); con él = restringe a los proyectos accesibles.
  const hits = await searchContext({ query: question, project, limit }, opts);
  const answer = await synthesizeContextAnswer(
    question,
    hits.map((h) => ({ title: h.entry.title, summary: h.entry.summary ?? h.entry.content, type: h.entry.type })),
  );
  return { answer, hits };
}

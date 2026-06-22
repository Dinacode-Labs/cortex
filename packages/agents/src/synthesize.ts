import { getAgent, runAgent } from "./mastra.js";

/**
 * Agente de recuperación (§7): sintetiza una respuesta en prosa fundamentada en
 * el contexto recuperado de Cortex. Implementado como Agent de Mastra (rol
 * "retriever", ver mastra.ts).
 */

export interface ContextSnippet {
  title: string;
  summary: string;
  type: string;
}

/** Sintetiza una respuesta a partir de fragmentos de contexto. null si no hay LLM. */
export async function synthesizeContextAnswer(
  question: string,
  snippets: ContextSnippet[],
): Promise<string | null> {
  if (!getAgent("retriever") || snippets.length === 0) return null;

  const context = snippets
    .map((s, i) => `${i + 1}. [${s.type}] ${s.title}: ${s.summary}`)
    .join("\n");
  const prompt = `Pregunta del developer: ${question}

Contexto recuperado de Cortex:
${context}

Responde a la pregunta basándote únicamente en el contexto anterior. Resalta riesgos,
decisiones vigentes y restricciones si son relevantes. Si falta información, indícalo.`;

  try {
    return await runAgent("retriever", prompt, { maxOutputTokens: 900 });
  } catch (e) {
    console.error("[agents] synthesizeContextAnswer falló:", (e as Error).message);
    return null;
  }
}

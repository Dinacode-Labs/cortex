import { chat, getLlmConfig } from "./openrouter.js";

/**
 * Agente de recuperación (§7): sintetiza una respuesta en prosa fundamentada en
 * el contexto recuperado de Cortex. Usa el cliente LLM directo (provider-agnóstico:
 * nan/OpenRouter). La orquestación con Mastra vive en el workflow de captura
 * (workflows.ts).
 */

export interface ContextSnippet {
  title: string;
  summary: string;
  type: string;
}

const SYSTEM =
  "Eres el agente de recuperación de Dinacode Cortex. Respondes preguntas de " +
  "developers sobre proyectos software basándote ÚNICAMENTE en el contexto " +
  "recuperado. Eres conciso, en español, y si el contexto no basta lo dices.";

/** Sintetiza una respuesta a partir de fragmentos de contexto. null si no hay LLM. */
export async function synthesizeContextAnswer(
  question: string,
  snippets: ContextSnippet[],
): Promise<string | null> {
  if (!getLlmConfig() || snippets.length === 0) return null;

  const context = snippets
    .map((s, i) => `${i + 1}. [${s.type}] ${s.title}: ${s.summary}`)
    .join("\n");
  const prompt = `Pregunta del developer: ${question}

Contexto recuperado de Cortex:
${context}

Responde a la pregunta basándote únicamente en el contexto anterior. Resalta riesgos,
decisiones vigentes y restricciones si son relevantes. Si falta información, indícalo.`;

  try {
    return await chat(
      [
        { role: "system", content: SYSTEM },
        { role: "user", content: prompt },
      ],
      { maxTokens: 900 },
    );
  } catch (e) {
    console.error("[agents] synthesizeContextAnswer falló:", (e as Error).message);
    return null;
  }
}

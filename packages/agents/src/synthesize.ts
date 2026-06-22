import { Agent } from "@mastra/core/agent";
import { createOpenRouter } from "@openrouter/ai-sdk-provider";
import { getLlmConfig } from "./openrouter.js";

/**
 * Agente de recuperación (§7) implementado con Mastra. Sintetiza una respuesta
 * en prosa, fundamentada en el contexto recuperado de Cortex. Usa generación de
 * texto de Mastra (que funciona bien con DeepSeek; la salida estructurada de
 * Mastra se delega al cliente directo, ver classify.ts y ADR-0006).
 */

let agent: Agent | undefined;

function getAgent(): Agent | null {
  const cfg = getLlmConfig();
  if (!cfg) return null;
  if (!agent) {
    const openrouter = createOpenRouter({ apiKey: cfg.apiKey });
    agent = new Agent({
      id: "retrieval",
      name: "retrieval",
      instructions:
        "Eres el agente de recuperación de Dinacode Cortex. Respondes preguntas de " +
        "developers sobre proyectos software basándote SOLO en el contexto recuperado. " +
        "Eres conciso, en español, y si el contexto no basta lo dices claramente.",
      model: openrouter.chat(cfg.model),
    });
  }
  return agent;
}

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
  const a = getAgent();
  if (!a || snippets.length === 0) return null;

  const context = snippets
    .map((s, i) => `${i + 1}. [${s.type}] ${s.title}: ${s.summary}`)
    .join("\n");
  const prompt = `Pregunta del developer: ${question}

Contexto recuperado de Cortex:
${context}

Responde a la pregunta basándote únicamente en el contexto anterior. Resalta riesgos,
decisiones vigentes y restricciones si son relevantes. Si falta información, indícalo.`;

  try {
    const res = await a.generate(prompt);
    return res.text;
  } catch (e) {
    console.error("[agents] synthesizeContextAnswer falló:", (e as Error).message);
    return null;
  }
}

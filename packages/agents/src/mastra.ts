import { createOpenAICompatible } from "@ai-sdk/openai-compatible";
import { Agent } from "@mastra/core/agent";
import { getLlmConfig } from "./openrouter.js";

/**
 * Agentes de Mastra de Cortex (§7). Un Agent por rol del pipeline de inteligencia:
 *   - classifier : ingesta/clasificación (tipo, título, resumen, entidades)
 *   - graph      : extracción de grafo (entidades + relaciones)
 *   - reranker   : reordenado de candidatos de retrieval
 *   - retriever  : síntesis de respuestas fundamentadas
 *
 * Todos hablan con el LLM por un provider OpenAI-compatible (nan/OpenRouter). Los
 * roles que devuelven JSON usan un `fetch` que fuerza `response_format:json_object`
 * (qwen3.6 no respeta `structuredOutput` de Mastra de forma fiable, pero con
 * json_object es rápido y válido — ver ADR-0006/0015). El retriever usa texto libre.
 */

export type AgentRole = "classifier" | "graph" | "reranker" | "retriever";

const INSTRUCTIONS: Record<AgentRole, string> = {
  classifier:
    "Eres el agente de ingesta de Dinacode Cortex, una memoria de contexto de " +
    "proyectos software. Clasificas piezas de conocimiento y extraes entidades. " +
    "Respondes SIEMPRE en español y SOLO con JSON válido.",
  graph:
    "Eres el agente de grafo de conocimiento de Dinacode Cortex. Extraes entidades " +
    "de dominio y relaciones de piezas de conocimiento de proyectos software. " +
    "Respondes SIEMPRE en español y SOLO con JSON válido.",
  reranker: "Eres un reranker de búsqueda de Dinacode Cortex. Respondes solo con JSON válido.",
  retriever:
    "Eres el agente de recuperación de Dinacode Cortex. Respondes preguntas de " +
    "developers sobre proyectos software basándote ÚNICAMENTE en el contexto " +
    "recuperado. Eres conciso, en español, y si el contexto no basta lo dices.",
};

const JSON_ROLES = new Set<AgentRole>(["classifier", "graph", "reranker"]);

/** fetch que fuerza response_format json_object en cada request OpenAI-compatible. */
const jsonFetch: typeof fetch = async (url, init) => {
  if (init?.body && typeof init.body === "string") {
    try {
      const b = JSON.parse(init.body);
      b.response_format = { type: "json_object" };
      init = { ...init, body: JSON.stringify(b) };
    } catch {
      /* cuerpo no-JSON: lo dejamos tal cual */
    }
  }
  return fetch(url as Parameters<typeof fetch>[0], init);
};

let cache: Record<AgentRole, Agent> | null | undefined;

function build(): Record<AgentRole, Agent> | null {
  const cfg = getLlmConfig();
  if (!cfg) return null;
  const model = (json: boolean) =>
    createOpenAICompatible({
      name: cfg.provider,
      baseURL: cfg.baseURL,
      apiKey: cfg.apiKey,
      ...(json ? { fetch: jsonFetch } : {}),
    })(cfg.model);
  const jsonModel = model(true);
  const textModel = model(false);
  const mk = (role: AgentRole) =>
    new Agent({
      id: `cortex-${role}`,
      name: `cortex-${role}`,
      instructions: INSTRUCTIONS[role],
      model: JSON_ROLES.has(role) ? jsonModel : textModel,
    });
  return { classifier: mk("classifier"), graph: mk("graph"), reranker: mk("reranker"), retriever: mk("retriever") };
}

/** Devuelve el Agent del rol, o null si no hay LLM configurado. */
export function getAgent(role: AgentRole): Agent | null {
  if (cache === undefined) cache = build();
  return cache ? cache[role] : null;
}

/** Ejecuta el agente del rol y devuelve su texto. Lanza si no hay LLM. */
export async function runAgent(
  role: AgentRole,
  prompt: string,
  opts: { maxOutputTokens?: number; maxRetries?: number } = {},
): Promise<string> {
  const agent = getAgent(role);
  if (!agent) throw new Error("LLM no habilitado (LLM_PROVIDER / API key).");
  const options: Record<string, unknown> = { maxRetries: opts.maxRetries ?? 6 };
  if (opts.maxOutputTokens) options.maxOutputTokens = opts.maxOutputTokens;
  const res = await agent.generate(prompt, options as never);
  return (res as { text?: string }).text ?? "";
}

import { Agent } from "@mastra/core/agent";
import { Mastra } from "@mastra/core";
import { Observability } from "@mastra/observability";
import { getLlmConfig } from "@cortex/shared";
import { CortexTraceExporter } from "../infrastructure/trace-exporter.js";
import { buildAgent } from "./model.js";
import { classifierInstructions } from "../agents/classifier/instructions.js";
import { graphInstructions } from "../agents/graph/instructions.js";
import { rerankerInstructions } from "../agents/reranker/instructions.js";
import { retrieverInstructions } from "../agents/retriever/instructions.js";
import { distillerInstructions } from "../agents/distiller/instructions.js";
import { mergerInstructions } from "../agents/merger/instructions.js";
import { reconcilerInstructions } from "../agents/reconciler/instructions.js";
import type { AgentRole } from "./roles.js";

/**
 * They all talk to the LLM through an OpenAI-compatible provider (see `model.ts` for the JSON
 * roles). The instructions live next to each agent (`agents/<role>/instructions.ts`); they are
 * in English and the **output language** stays Spanish on purpose. What these agents produce is
 * not source code: it is knowledge entries that get stored next to a corpus that is already
 * Spanish, and answers read by a Spanish-speaking team. Changing the prompt language is a
 * translation; changing the output language is a product decision.
 */

const INSTRUCTIONS: Record<AgentRole, string> = {
  classifier: classifierInstructions,
  graph: graphInstructions,
  reranker: rerankerInstructions,
  retriever: retrieverInstructions,
  distiller: distillerInstructions,
  merger: mergerInstructions,
  reconciler: reconcilerInstructions,
};

let mastra: Mastra | null | undefined;

function build(): Mastra | null {
  if (!getLlmConfig()) return null;
  const mk = (role: AgentRole) => buildAgent(role, INSTRUCTIONS[role]);
  // The Mastra instance: registered agents plus observability (AI tracing) into our own
  // exporter (ADR-0016, part B). The agents are served from here so that `generate()` emits
  // spans.
  return new Mastra({
    agents: { classifier: mk("classifier"), graph: mk("graph"), reranker: mk("reranker"), retriever: mk("retriever"), distiller: mk("distiller"), merger: mk("merger"), reconciler: mk("reconciler") },
    observability: new Observability({
      configs: { default: { serviceName: "cortex", exporters: [new CortexTraceExporter()] } },
    }),
  } as ConstructorParameters<typeof Mastra>[0]);
}

export function getAgent(role: AgentRole): Agent | null {
  if (mastra === undefined) mastra = build();
  return mastra ? (mastra.getAgent(role) as Agent) : null;
}

/** Flushes/closes observability (for CLIs that end with process.exit). */
export async function shutdownObservability(): Promise<void> {
  if (mastra) {
    try {
      await (mastra as unknown as { shutdown?: () => Promise<void> }).shutdown?.();
    } catch {
      /* best-effort */
    }
  }
}

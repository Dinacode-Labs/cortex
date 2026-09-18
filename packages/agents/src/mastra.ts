import { createOpenAICompatible } from "@ai-sdk/openai-compatible";
import { Agent } from "@mastra/core/agent";
import { Mastra } from "@mastra/core";
import { Observability } from "@mastra/observability";
import { recordUsage } from "@cortex/core";
import { getLlmConfig, type LlmConfig, withLlmSlot } from "@cortex/shared";
import { CortexTraceExporter } from "./trace-exporter.js";

/**
 * Cortex's Mastra agents (section 7). One Agent per role of the intelligence pipeline:
 *   - classifier : ingestion/classification (type, title, summary, entities)
 *   - graph      : graph extraction (entities + relations)
 *   - reranker   : reordering of retrieval candidates
 *   - retriever  : synthesis of grounded answers
 *
 * They all talk to the LLM through an OpenAI-compatible provider. The roles that return JSON
 * use a `fetch` that forces `response_format:json_object` (some models do not honour Mastra's
 * `structuredOutput` reliably, but with json_object they are fast and valid -- see
 * ADR-0006/0015). The retriever uses free text.
 *
 * The instructions below are in English; the **output language** stays Spanish on purpose.
 * What these agents produce is not source code: it is knowledge entries that get stored next
 * to a corpus that is already Spanish, and answers read by a Spanish-speaking team. Changing
 * the prompt language is a translation; changing the output language is a product decision.
 */

export type AgentRole = "classifier" | "graph" | "reranker" | "retriever" | "distiller" | "merger" | "reconciler";

const OUTPUT_LANGUAGE = "Spanish";

const INSTRUCTIONS: Record<AgentRole, string> = {
  classifier:
    "You are Cortex's ingestion agent. Cortex is a context memory for software projects. " +
    "You classify pieces of knowledge and extract entities. " +
    `You ALWAYS answer in ${OUTPUT_LANGUAGE} and ONLY with valid JSON.`,
  graph:
    "You are Cortex's knowledge-graph agent. You extract domain entities and relations from " +
    "pieces of knowledge about software projects. " +
    `You ALWAYS answer in ${OUTPUT_LANGUAGE} and ONLY with valid JSON.`,
  reranker: "You are a search reranker for Cortex. You answer only with valid JSON.",
  retriever:
    "You are Cortex's retrieval agent. You answer developers' questions about software " +
    "projects based ONLY on the retrieved context. You are concise, you write in " +
    `${OUTPUT_LANGUAGE}, and when the context is not enough you say so.`,
  distiller:
    "You are Cortex's distillation agent. From transcripts of AI agents working on a " +
    "project, you extract ONLY the DURABLE, reusable knowledge (technical decisions, " +
    "constraints, incidents and how they were resolved, conventions, technical debt, risks, " +
    "how-tos). You discard the noise (tool calls, file dumps, narration, greetings, abandoned " +
    "attempts) and you NEVER include secrets. " +
    `You ALWAYS answer in ${OUTPUT_LANGUAGE} and ONLY with valid JSON.`,
  merger:
    "You are Cortex's consolidation agent. You merge two pieces of knowledge about the same " +
    "thing into ONE, keeping everything relevant from both, without redundancy, concise and " +
    `in ${OUTPUT_LANGUAGE}. You return ONLY the consolidated text (no preamble), with a short ` +
    "title on the first line.",
  reconciler:
    "You are Cortex's reconciliation agent. Given an EXISTING piece and a NEW one about the " +
    "same subject, you decide their relationship and answer ONLY with JSON " +
    '{"decision": one of [noop, update, supersede]}: "noop" = the new one adds nothing; ' +
    '"update" = the new one refines/adds detail WITHOUT contradicting; "supersede" = the new ' +
    "one CONTRADICTS or replaces/invalidates the existing one (the existing one is NO longer " +
    "valid).",
};

const JSON_ROLES = new Set<AgentRole>(["classifier", "graph", "reranker", "distiller", "reconciler"]);

/** A fetch that forces response_format json_object on every OpenAI-compatible request. */
const jsonFetch: typeof fetch = async (url, init) => {
  if (init?.body && typeof init.body === "string") {
    try {
      const b = JSON.parse(init.body);
      b.response_format = { type: "json_object" };
      init = { ...init, body: JSON.stringify(b) };
    } catch {
      /* non-JSON body: leave it as it is */
    }
  }
  return fetch(url as Parameters<typeof fetch>[0], init);
};

let mastra: Mastra | null | undefined;

function build(): Mastra | null {
  if (!getLlmConfig()) return null;
  // One model PER ROLE: getLlmConfig(role) resolves CORTEX_MODEL_<ROLE> (ADR-0023), so
  // different roles can use different models (cheap for the mechanical work, powerful for the
  // judgement). Same OpenAI-compatible endpoint; only the model id changes.
  const buildModel = (cfg: LlmConfig, json: boolean) =>
    createOpenAICompatible({
      name: cfg.provider,
      baseURL: cfg.baseURL,
      apiKey: cfg.apiKey,
      ...(json ? { fetch: jsonFetch } : {}),
    })(cfg.model);
  const mk = (role: AgentRole) => {
    const cfg = getLlmConfig(role)!; // not null: getLlmConfig() validated above
    return new Agent({
      id: `cortex-${role}`,
      name: `cortex-${role}`,
      instructions: INSTRUCTIONS[role],
      model: buildModel(cfg, JSON_ROLES.has(role)),
    });
  };
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

/** Returns the role's Agent, or null when no LLM is configured. */
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

/** Runs the role's agent and returns its text. Throws when there is no LLM. */
export async function runAgent(
  role: AgentRole,
  prompt: string,
  opts: { maxOutputTokens?: number; maxRetries?: number } = {},
): Promise<string> {
  const agent = getAgent(role);
  if (!agent) throw new Error("LLM not enabled (LLM_PROVIDER / API key).");
  const options: Record<string, unknown> = { maxRetries: opts.maxRetries ?? 6 };
  if (opts.maxOutputTokens) options.maxOutputTokens = opts.maxOutputTokens;
  const t0 = Date.now();
  // One slot per call: the provider caps concurrent requests per API key, and
  // enrich/maintain fires several in parallel (CORTEX_ENRICH_CONCURRENCY).
  const res = (await withLlmSlot(() => agent.generate(prompt, options as never))) as {
    text?: string;
    usage?: { inputTokens?: number; outputTokens?: number; totalTokens?: number; promptTokens?: number; completionTokens?: number };
    response?: { modelId?: string };
  };
  const cfg = getLlmConfig(role);
  const u = res.usage ?? {};
  if (cfg) {
    // We record the SERVED model (res.response.modelId) when it arrives, not the requested
    // one: that catches OpenRouter routing and silent provider degradation (ADR-0023, section
    // 6.3). It falls back to the model requested for the role.
    const servedModel = res.response?.modelId?.trim() || cfg.model;
    await recordUsage({
      operation: role,
      provider: cfg.provider,
      model: servedModel,
      inputTokens: u.inputTokens ?? u.promptTokens ?? 0,
      outputTokens: u.outputTokens ?? u.completionTokens ?? 0,
      totalTokens: u.totalTokens,
      durationMs: Date.now() - t0,
    });
  }
  return res.text ?? "";
}

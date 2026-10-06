import { getEnv } from "@cortex/shared";

export interface UsageRecord {
  kind?: "llm" | "embedding";
  provider: string;
  model: string;
  operation: string;
  project?: string | null;
  inputTokens?: number;
  outputTokens?: number;
  totalTokens?: number;
  durationMs?: number;
}

export interface UsageEntry {
  kind: "llm" | "embedding";
  provider: string;
  model: string;
  operation: string;
  project: string | null;
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
  costUsd: number;
  durationMs: number | null;
}

export interface UsageSummary {
  totals: { calls: number; inputTokens: number; outputTokens: number; totalTokens: number; costUsd: number };
  byOperation: { operation: string; kind: string; calls: number; totalTokens: number; costUsd: number }[];
  byModel: { model: string; provider: string; calls: number; totalTokens: number; costUsd: number }[];
  recent: { createdAt: string; operation: string; model: string; totalTokens: number; costUsd: number; project: string | null }[];
}

export interface TraceSpan {
  spanId: string;
  parentSpanId: string | null;
  name: string | null;
  spanType: string | null;
  entityName: string | null;
  model: string | null;
  inputTokens: number | null;
  outputTokens: number | null;
  durationMs: number | null;
  status: string | null;
}
export interface TraceTree {
  traceId: string;
  startedAt: string;
  rootName: string;
  totalDurationMs: number;
  totalTokens: number;
  spans: TraceSpan[];
}

export interface UsageRepository {
  record(entry: UsageEntry): Promise<void>;
  summary(): Promise<UsageSummary>;
  recentTraces(limit: number): Promise<TraceTree[]>;
}

/** Approximate public prices (USD per 1M tokens), as of 2026-07-13. For ESTIMATING cost
 * only; adjust to your contract/catalogue (they change fast). Anything unlisted counts as 0
 * and is warned about once (ADR-0021 / ADR-0023 section 6.3). */
const PRICING: Record<string, { in: number; out: number }> = {
  // NaN (monthly subscription: the marginal cost per token is 0). ADR-0024.
  "deepseek-v4-flash": { in: 0, out: 0 },
  "glm5.3-flash": { in: 0, out: 0 },
  "mimo-v2.5": { in: 0, out: 0 },
  "qwen3.8-flash": { in: 0, out: 0 },
  "qwen3.6": { in: 0, out: 0 },
  "qwen3-embedding": { in: 0, out: 0 },
  whisper: { in: 0, out: 0 },
  "gpt-4o-mini": { in: 0.15, out: 0.6 },
  "gpt-4o": { in: 2.5, out: 10 },
  "text-embedding-3-small": { in: 0.02, out: 0 },
  "text-embedding-3-large": { in: 0.13, out: 0 },
  // OpenRouter -- per-role routing (ADR-0023)
  "deepseek/deepseek-v4-pro": { in: 0.43, out: 0.87 },
  "deepseek/deepseek-v4-flash": { in: 0.08, out: 0.15 },
  "x-ai/grok-4.5": { in: 2.0, out: 6.0 },
  "anthropic/claude-sonnet-5": { in: 2.0, out: 10.0 },
  "qwen/qwen3.5-flash-02-23": { in: 0.07, out: 0.26 },
  "voyage-3": { in: 0.06, out: 0 },
  "voyage-3-lite": { in: 0.02, out: 0 },
};

const warnedUnpriced = new Set<string>();

let merged: Record<string, { in: number; out: number }> | undefined;

/** The effective table: the one in code plus whatever `CORTEX_PRICING_JSON` adds. It allows
 *  fixing a price or registering a new model without deploying (which closes ADR-0021's
 *  "revisit when"). Invalid JSON -> a warning and it is ignored: observability never breaks
 *  anything. */
function pricing(): Record<string, { in: number; out: number }> {
  if (merged) return merged;
  merged = { ...PRICING };
  const raw = getEnv("CORTEX_PRICING_JSON", "").trim();
  if (raw) {
    try {
      const extra = JSON.parse(raw) as Record<string, { in?: number; out?: number }>;
      for (const [model, p] of Object.entries(extra)) {
        if (typeof p?.in === "number" && typeof p?.out === "number") merged[model] = { in: p.in, out: p.out };
        else console.warn(`[usage] CORTEX_PRICING_JSON: invalid entry for "${model}" (in/out numbers expected).`);
      }
    } catch (e) {
      console.warn(`[usage] CORTEX_PRICING_JSON is not valid JSON and is ignored: ${(e as Error).message}`);
    }
  }
  return merged;
}

/** Tests only: forces `CORTEX_PRICING_JSON` to be read again. @internal */
export function resetPricingCache(): void {
  merged = undefined;
  warnedUnpriced.clear();
}

/** A call's estimated cost in USD. @internal (exported for tests) */
export function estimateCostUsd(model: string, inTok: number, outTok: number): number {
  const table = pricing();
  const p = table[model] ?? table[model.split("/").pop() ?? ""];
  if (!p) {
    if (!warnedUnpriced.has(model)) {
      warnedUnpriced.add(model);
      console.warn(`[usage] model with no price in PRICING: "${model}" -> estimated cost $0. Add it to usage.ts.`);
    }
    return 0;
  }
  return (inTok / 1_000_000) * p.in + (outTok / 1_000_000) * p.out;
}

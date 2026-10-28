import { getEnv } from "@cortex/shared";

export interface UsageRecord {
  kind?: "llm" | "embedding";
  provider: string;
  model: string;
  operation: string;
  projectId?: string | null;
  /** The host the call went to (ADR-0100): `provider` reads `openai-compatible` for every self-hosted or paid endpoint alike. */
  endpoint?: string | null;
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
  projectId: string | null;
  endpoint: string | null;
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
  costUsd: number;
  durationMs: number | null;
}

export interface UsageFilter {
  since: Date;
  projectId?: string;
  endpoint?: string;
}

export interface UsageFigures {
  calls: number;
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
  costUsd: number;
}

export interface UsageDay extends UsageFigures {
  /** `YYYY-MM-DD`, in UTC. */
  day: string;
}

export interface UsageSummary {
  totals: UsageFigures;
  daily: UsageDay[];
  byProject: ({ projectId: string | null; name: string | null; slug: string | null } & UsageFigures)[];
  byEndpoint: ({ endpoint: string | null; providers: string[] } & UsageFigures)[];
  byOperation: ({ operation: string; kind: string } & UsageFigures)[];
  byModel: ({ model: string; provider: string } & UsageFigures)[];
  recent: { createdAt: string; operation: string; model: string; totalTokens: number; costUsd: number; projectName: string | null; endpoint: string | null }[];
}

export interface UsageFacets {
  projects: { id: string; name: string; slug: string | null }[];
  endpoints: string[];
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
  /** `daily` holds only the days with calls; the use case fills in the rest. */
  summary(filter: UsageFilter): Promise<UsageSummary>;
  /** The projects and endpoints that have spent anything, ever: what the filters offer. */
  facets(): Promise<UsageFacets>;
  recentTraces(limit: number): Promise<TraceTree[]>;
}

export const USAGE_PERIODS = [7, 30, 90] as const;
export const DEFAULT_USAGE_PERIOD = 30;

/** The UTC days a period of `length` days covers, oldest first and ending on `now`'s. */
export function periodDays(length: number, now: Date): string[] {
  const today = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate());
  const count = Math.max(1, Math.floor(length));
  return Array.from({ length: count }, (_, i) => new Date(today - (count - 1 - i) * 86_400_000).toISOString().slice(0, 10));
}

/** A day with no calls is a zero, not a gap: a chart that skips it draws a quiet week as busy. */
export function fillDays(days: string[], spent: UsageDay[]): UsageDay[] {
  const byDay = new Map(spent.map((d) => [d.day, d]));
  return days.map((day) => byDay.get(day) ?? { day, calls: 0, inputTokens: 0, outputTokens: 0, totalTokens: 0, costUsd: 0 });
}

/** Only the host: a base URL may carry credentials in its user-info, and the host is what names a subscription. */
export function endpointHost(baseURL: string | null | undefined): string | null {
  if (!baseURL) return null;
  try {
    return new URL(baseURL).host || null;
  } catch {
    return null;
  }
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

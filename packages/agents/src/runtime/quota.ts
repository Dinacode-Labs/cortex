import { getEnv } from "@cortex/shared";
import { getLlmConfig, type LlmConfig } from "./llm-config.js";
import type { AgentRole } from "./roles.js";

/** A model's quota as the operator's plan states it: no provider's plan is written in the code (ADR-0102). */
export interface ModelQuota {
  tokens: number;
  /** The UTC day of the month its count starts again on: 1 for a calendar month. */
  resetDay: number;
}

export type QuotaLeft =
  | { kind: "tokens"; used: number; limit: number; since: string }
  | { kind: "credit"; remaining: number; limit: number; resets: string | null }
  | { kind: "unlimited" }
  | { kind: "unknown"; why: "no-quota-on-file" | "not-reported" | "no-answer" };

export interface QuotaOptions {
  fetch?: typeof fetch;
  now?: Date;
}

const QUOTAS_VARIABLE = "CORTEX_MODEL_QUOTAS_JSON";
const READING_TTL_MS = 60_000;
const PROVIDER_TIMEOUT_MS = 4_000;

let warnedAbout = "";

function warnOnce(raw: string, message: string): void {
  if (warnedAbout === raw) return;
  warnedAbout = raw;
  console.warn(`[quota] ${QUOTAS_VARIABLE}: ${message}`);
}

function quotaEntry(value: unknown): ModelQuota | null | undefined {
  if (value === null) return null;
  if (typeof value !== "object") return undefined;
  const { tokens, resetDay = 1 } = value as { tokens?: unknown; resetDay?: unknown };
  if (typeof tokens !== "number" || !Number.isFinite(tokens) || tokens <= 0) return undefined;
  // Day 28 at most: a quota that starts again on the 31st has no start in February.
  if (!Number.isInteger(resetDay) || (resetDay as number) < 1 || (resetDay as number) > 28) return undefined;
  return { tokens, resetDay: resetDay as number };
}

/** Each model's quota, by its id; null marks a model the plan does not count. */
export function modelQuotas(): Map<string, ModelQuota | null> {
  const raw = getEnv(QUOTAS_VARIABLE, "").trim();
  const quotas = new Map<string, ModelQuota | null>();
  if (!raw) return quotas;
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (e) {
    warnOnce(raw, `not valid JSON, so no quota is on file: ${(e as Error).message}`);
    return quotas;
  }
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
    warnOnce(raw, "expected an object of model ids, so no quota is on file.");
    return quotas;
  }
  const invalid: string[] = [];
  for (const [model, value] of Object.entries(parsed)) {
    const quota = quotaEntry(value);
    if (quota === undefined) invalid.push(model);
    else quotas.set(model, quota);
  }
  if (invalid.length) {
    warnOnce(raw, `ignored ${invalid.map((m) => `"${m}"`).join(", ")}: {"tokens": n} or {"tokens": n, "resetDay": 1-28} expected, or null.`);
  }
  return quotas;
}

/** The first UTC day of the period `now` falls in, `YYYY-MM-DD`. */
export function periodStart(resetDay: number, now: Date): string {
  const year = now.getUTCFullYear();
  const month = now.getUTCMonth();
  const start = now.getUTCDate() >= resetDay ? Date.UTC(year, month, resetDay) : Date.UTC(year, month - 1, resetDay);
  return new Date(start).toISOString().slice(0, 10);
}

type UsageReport = Map<string, number> | "not-reported" | "no-answer";

const readings = new Map<string, { at: number; value: Promise<UsageReport | QuotaLeft> }>();

/** Tests only: forgets what the providers answered. @internal */
export function forgetQuotaReadings(): void {
  readings.clear();
  warnedAbout = "";
}

/** The page asks once per provider and period, not once per agent: the usage endpoint has its own rate limit. */
function remembered<T extends UsageReport | QuotaLeft>(key: string, now: Date, read: () => Promise<T>): Promise<T> {
  const hit = readings.get(key);
  if (hit && now.getTime() - hit.at < READING_TTL_MS) return hit.value as Promise<T>;
  const value = read();
  readings.set(key, { at: now.getTime(), value });
  return value;
}

async function getJson(url: string, cfg: LlmConfig, fetchFn: typeof fetch): Promise<{ status: number; body: unknown } | null> {
  try {
    const res = await fetchFn(url, {
      headers: { Authorization: `Bearer ${cfg.apiKey}` },
      signal: AbortSignal.timeout(PROVIDER_TIMEOUT_MS),
    });
    return { status: res.status, body: res.ok ? await res.json().catch(() => null) : null };
  } catch {
    return null;
  }
}

const endpoint = (cfg: LlmConfig, path: string): string => `${cfg.baseURL.replace(/\/+$/, "")}${path}`;

/** Tokens each model has spent on the whole account since `since`, as the provider counts them. */
async function usedSince(cfg: LlmConfig, since: string, today: string, fetchFn: typeof fetch): Promise<UsageReport> {
  // `totals.by_model` covers the whole window whatever the page size, so one row of `data` is enough.
  const query = new URLSearchParams({ start_date: since, end_date: today, limit: "1" });
  const res = await getJson(`${endpoint(cfg, "/usage")}?${query}`, cfg, fetchFn);
  if (!res) return "no-answer";
  if (res.status === 404) return "not-reported";
  if (res.status !== 200) return "no-answer";
  const report = res.body as { object?: unknown; totals?: { by_model?: unknown } } | null;
  if (report?.object !== "usage.report" || !Array.isArray(report.totals?.by_model)) return "not-reported";
  const byModel = report.totals.by_model as { model?: unknown; total_tokens?: unknown }[];
  return new Map(byModel.map((row) => [String(row.model), Number(row.total_tokens) || 0]));
}

async function keyCredit(cfg: LlmConfig, fetchFn: typeof fetch): Promise<QuotaLeft> {
  const res = await getJson(endpoint(cfg, "/key"), cfg, fetchFn);
  if (!res || res.status !== 200) return { kind: "unknown", why: res?.status === 404 ? "not-reported" : "no-answer" };
  const key = (res.body as { data?: { limit?: unknown; limit_remaining?: unknown; limit_reset?: unknown } } | null)?.data;
  if (!key) return { kind: "unknown", why: "not-reported" };
  if (key.limit === null) return { kind: "unlimited" };
  if (typeof key.limit !== "number" || typeof key.limit_remaining !== "number") return { kind: "unknown", why: "not-reported" };
  return {
    kind: "credit",
    remaining: key.limit_remaining,
    limit: key.limit,
    resets: typeof key.limit_reset === "string" ? key.limit_reset : null,
  };
}

/**
 * What is left of the quota of the model a role runs on, as its provider reports it (ADR-0102).
 * Null when the role calls no model. It never throws: a provider that is down is a reading too.
 */
export async function quotaLeft(role: AgentRole, saved?: string | null, options: QuotaOptions = {}): Promise<QuotaLeft | null> {
  const cfg = getLlmConfig(role, saved);
  if (!cfg) return null;
  const fetchFn = options.fetch ?? fetch;
  const now = options.now ?? new Date();

  if (cfg.provider === "openrouter") {
    return remembered(`${cfg.baseURL} ${cfg.apiKey} key`, now, () => keyCredit(cfg, fetchFn));
  }

  const quota = modelQuotas().get(cfg.model);
  if (quota === undefined) return { kind: "unknown", why: "no-quota-on-file" };
  if (quota === null) return { kind: "unlimited" };
  const since = periodStart(quota.resetDay, now);
  const today = now.toISOString().slice(0, 10);
  const report = await remembered(`${cfg.baseURL} ${cfg.apiKey} ${since}`, now, () => usedSince(cfg, since, today, fetchFn));
  if (typeof report === "string") return { kind: "unknown", why: report };
  return { kind: "tokens", used: report.get(cfg.model) ?? 0, limit: quota.tokens, since };
}

/** The share left, 0–100, or null when there is no limit to measure against. */
export function shareLeft(left: QuotaLeft): number | null {
  if (left.kind === "tokens") return Math.max(0, Math.min(100, ((left.limit - left.used) / left.limit) * 100));
  if (left.kind === "credit") return left.limit > 0 ? Math.max(0, Math.min(100, (left.remaining / left.limit) * 100)) : 0;
  return null;
}

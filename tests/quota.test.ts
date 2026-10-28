import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { agentRole } from "@cortex/shared";
import { roleModelVariable } from "../packages/agents/src/runtime/llm-config";
import { forgetQuotaReadings, modelQuotas, periodStart, quotaLeft, shareLeft } from "../packages/agents/src/runtime/quota";

const VARS = [
  "LLM_PROVIDER", "LLM_BASE_URL", "LLM_API_KEY", "LLM_MODEL", "LLM_ALLOW_NO_KEY",
  "NAN_API_KEY", "NAN_BASE_URL", "NAN_LLM_MODEL", "OPENROUTER_API_KEY", "OPENROUTER_MODEL",
  "CORTEX_MODEL_QUOTAS_JSON", ...agentRole.options.map(roleModelVariable),
];
const NOW = new Date("2026-10-28T09:30:00Z");

function onEndpoint(quotas?: object) {
  vi.stubEnv("LLM_PROVIDER", "openai-compatible");
  vi.stubEnv("LLM_BASE_URL", "https://llm.example.com/v1/");
  vi.stubEnv("LLM_API_KEY", "endpoint-key");
  vi.stubEnv("LLM_MODEL", "base-model");
  if (quotas) vi.stubEnv("CORTEX_MODEL_QUOTAS_JSON", JSON.stringify(quotas));
}

function answering(status: number, body: unknown) {
  return vi.fn(async (_url: string | URL | Request, _init?: RequestInit) =>
    new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } }),
  );
}

function usageReport(byModel: Record<string, number>) {
  return {
    object: "usage.report",
    data: [],
    totals: { by_model: Object.entries(byModel).map(([model, total_tokens]) => ({ model, total_tokens })) },
    has_more: true,
    next_cursor: "page-2",
  };
}

beforeEach(() => {
  for (const v of VARS) vi.stubEnv(v, "");
  vi.spyOn(console, "warn").mockImplementation(() => {});
  forgetQuotaReadings();
});
afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

/**
 * What is left of a model's quota is the provider's count for the whole account, measured against
 * the quota the operator's plan states (ADR-0102). Cortex's own usage table would only say what
 * Cortex spent, and the account runs dry on everything else that shares the key too.
 */
describe("what is left of the quota of the model an agent runs on", () => {
  it("measures the provider's count since the period began against the quota on file", async () => {
    onEndpoint({ "base-model": { tokens: 1_000 } });
    const fetch = answering(200, usageReport({ "base-model": 250, "another-model": 9_999 }));

    const left = await quotaLeft("judge", null, { fetch, now: NOW });

    expect(left).toEqual({ kind: "tokens", used: 250, limit: 1_000, since: "2026-10-01" });
    expect(shareLeft(left!)).toBe(75);
    const [url, init] = fetch.mock.calls[0]!;
    expect(String(url)).toBe("https://llm.example.com/v1/usage?start_date=2026-10-01&end_date=2026-10-28&limit=1");
    expect(new Headers(init?.headers).get("Authorization")).toBe("Bearer endpoint-key");
  });

  it("counts a model the provider has no row for as nothing spent", async () => {
    onEndpoint({ "base-model": { tokens: 1_000 } });
    const left = await quotaLeft("judge", null, { fetch: answering(200, usageReport({})), now: NOW });

    expect(left).toMatchObject({ kind: "tokens", used: 0 });
  });

  /**
   * A model with no quota on file is not a full one: the price table's "$0 that means nothing is
   * on file" looked exactly like free, and nobody noticed until the bill (ADR-0021).
   */
  it("says there is no quota on file, rather than drawing it full, and does not ask the provider", async () => {
    onEndpoint();
    const fetch = answering(200, usageReport({ "base-model": 250 }));

    expect(await quotaLeft("judge", null, { fetch, now: NOW })).toEqual({ kind: "unknown", why: "no-quota-on-file" });
    vi.stubEnv("CORTEX_MODEL_QUOTAS_JSON", JSON.stringify({ "base-model": null }));
    expect(await quotaLeft("judge", null, { fetch, now: NOW })).toEqual({ kind: "unlimited" });
    expect(fetch).not.toHaveBeenCalled();
  });

  it("is a reading when the provider does not count usage or does not answer, never an error on the page", async () => {
    onEndpoint({ "base-model": { tokens: 1_000 } });
    const read = async (fetch: typeof globalThis.fetch) => {
      forgetQuotaReadings();
      return quotaLeft("judge", null, { fetch, now: NOW });
    };

    expect(await read(answering(404, { error: "not found" }))).toEqual({ kind: "unknown", why: "not-reported" });
    expect(await read(answering(200, { data: [] }))).toEqual({ kind: "unknown", why: "not-reported" });
    expect(await read(answering(429, { error: "slow down" }))).toEqual({ kind: "unknown", why: "no-answer" });
    expect(await read(vi.fn(async () => Promise.reject(new Error("ECONNREFUSED"))))).toEqual({ kind: "unknown", why: "no-answer" });
  });

  /** The usage endpoint has a rate limit of its own, and the page has an agent per role on the same account. */
  it("asks the provider once for every agent on the same account and period", async () => {
    onEndpoint({ "base-model": { tokens: 1_000 }, "judge-model": { tokens: 500 } });
    const fetch = answering(200, usageReport({ "base-model": 100, "judge-model": 50 }));

    const lefts = await Promise.all(
      agentRole.options.map((role) => quotaLeft(role, role === "judge" ? "judge-model" : null, { fetch, now: NOW })),
    );

    expect(fetch).toHaveBeenCalledTimes(1);
    expect(lefts.filter((left) => left?.kind === "tokens" && left.used === 100)).toHaveLength(agentRole.options.length - 1);
    expect(lefts[agentRole.options.indexOf("judge")]).toMatchObject({ used: 50, limit: 500 });
  });

  it("takes the provider's own credit for a role sent to OpenRouter, with no quota on file", async () => {
    onEndpoint();
    vi.stubEnv("OPENROUTER_API_KEY", "or-key");
    const fetch = answering(200, { data: { limit: 20, limit_remaining: 5, limit_reset: "monthly", usage: 15 } });

    const left = await quotaLeft("retriever", "openrouter:x-ai/grok-4.5", { fetch, now: NOW });

    expect(left).toEqual({ kind: "credit", remaining: 5, limit: 20, resets: "monthly" });
    expect(shareLeft(left!)).toBe(25);
    expect(String(fetch.mock.calls[0]![0])).toBe("https://openrouter.ai/api/v1/key");

    forgetQuotaReadings();
    const unlimited = answering(200, { data: { limit: null, limit_remaining: null, limit_reset: null, usage: 15 } });
    expect(await quotaLeft("retriever", "openrouter:x-ai/grok-4.5", { fetch: unlimited, now: NOW })).toEqual({ kind: "unlimited" });
  });

  it("is null for a role that calls no model", async () => {
    expect(await quotaLeft("judge", null, { fetch: answering(200, {}), now: NOW })).toBeNull();
  });
});

describe("the quota on file", () => {
  /** A plan billed from the 14th starts its count on the 14th: a calendar month would reset it two weeks early. */
  it("starts its period on the day it resets, in last month until that day comes", () => {
    expect(periodStart(1, NOW)).toBe("2026-10-01");
    expect(periodStart(14, new Date("2026-10-13T23:59:00Z"))).toBe("2026-09-14");
    expect(periodStart(14, new Date("2026-10-14T00:00:00Z"))).toBe("2026-10-14");
    expect(periodStart(5, new Date("2026-01-03T12:00:00Z"))).toBe("2025-12-05");
  });

  it("ignores, and names, every entry it cannot read rather than guessing it", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    vi.stubEnv(
      "CORTEX_MODEL_QUOTAS_JSON",
      JSON.stringify({
        good: { tokens: 3e9, resetDay: 14 },
        words: { tokens: "lots" },
        "day-31": { tokens: 10, resetDay: 31 },
        negative: { tokens: -1 },
      }),
    );

    expect([...modelQuotas()]).toEqual([["good", { tokens: 3e9, resetDay: 14 }]]);
    expect(warn).toHaveBeenCalledWith(expect.stringMatching(/"words", "day-31", "negative"/));
  });

  it("is empty, with a warning, when it is not JSON", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    vi.stubEnv("CORTEX_MODEL_QUOTAS_JSON", "{deepseek: 3B}");

    expect(modelQuotas().size).toBe(0);
    expect(warn).toHaveBeenCalledWith(expect.stringContaining("not valid JSON"));
  });
});

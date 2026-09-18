import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { estimateCostUsd, resetPricingCache } from "@cortex/core";

/**
 * The price table lives in code (ADR-0021) and prices change fast. `CORTEX_PRICING_JSON` allows
 * fixing one or registering a model without deploying; what matters is that a broken JSON does
 * NOT bring the pipeline down: cost observability is incidental, it cannot be a point of
 * failure.
 */
beforeEach(() => {
  vi.stubEnv("CORTEX_PRICING_JSON", "");
  vi.spyOn(console, "warn").mockImplementation(() => {});
  resetPricingCache();
});
afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
  resetPricingCache();
});

describe("estimateCostUsd", () => {
  it("NaN's models cost 0 (a subscription, with no marginal cost)", () => {
    expect(estimateCostUsd("deepseek-v4-flash", 1_000_000, 1_000_000)).toBe(0);
    expect(estimateCostUsd("qwen3-embedding", 5_000_000, 0)).toBe(0);
  });

  it("calculates per million input and output tokens", () => {
    // grok-4.5: 2.0 in / 6.0 out per 1M
    expect(estimateCostUsd("x-ai/grok-4.5", 1_000_000, 1_000_000)).toBeCloseTo(8.0, 6);
    expect(estimateCostUsd("x-ai/grok-4.5", 500_000, 0)).toBeCloseTo(1.0, 6);
  });

  it("a model with no price counts as 0 and does not throw", () => {
    expect(estimateCostUsd("modelo-inexistente-xyz", 1_000_000, 1_000_000)).toBe(0);
  });

  it("CORTEX_PRICING_JSON adds new models and overwrites existing ones", () => {
    vi.stubEnv("CORTEX_PRICING_JSON", '{"modelo-propio":{"in":1,"out":2},"x-ai/grok-4.5":{"in":0,"out":0}}');
    resetPricingCache();
    expect(estimateCostUsd("modelo-propio", 1_000_000, 1_000_000)).toBeCloseTo(3.0, 6);
    expect(estimateCostUsd("x-ai/grok-4.5", 1_000_000, 1_000_000)).toBe(0); // sobreescrito
  });

  it("invalid JSON is ignored and the table in code keeps being used", () => {
    vi.stubEnv("CORTEX_PRICING_JSON", "{this is not json");
    resetPricingCache();
    expect(estimateCostUsd("x-ai/grok-4.5", 1_000_000, 0)).toBeCloseTo(2.0, 6);
  });
});

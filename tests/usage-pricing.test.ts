import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { estimateCostUsd, resetPricingCache } from "@cortex/core";

/**
 * La tabla de precios vive en código (ADR-0021) y los precios cambian rápido.
 * `CORTEX_PRICING_JSON` permite corregir uno o dar de alta un modelo sin desplegar; lo
 * importante es que un JSON roto NO tumbe el pipeline: la observabilidad de coste es
 * accesoria, no puede ser un punto de fallo.
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
  it("los modelos de NaN cuestan 0 (suscripción, sin coste marginal)", () => {
    expect(estimateCostUsd("deepseek-v4-flash", 1_000_000, 1_000_000)).toBe(0);
    expect(estimateCostUsd("qwen3-embedding", 5_000_000, 0)).toBe(0);
  });

  it("calcula por millón de tokens de entrada y salida", () => {
    // grok-4.5: 2.0 in / 6.0 out por 1M
    expect(estimateCostUsd("x-ai/grok-4.5", 1_000_000, 1_000_000)).toBeCloseTo(8.0, 6);
    expect(estimateCostUsd("x-ai/grok-4.5", 500_000, 0)).toBeCloseTo(1.0, 6);
  });

  it("un modelo sin precio cuenta como 0 y no lanza", () => {
    expect(estimateCostUsd("modelo-inexistente-xyz", 1_000_000, 1_000_000)).toBe(0);
  });

  it("CORTEX_PRICING_JSON añade modelos nuevos y sobreescribe los existentes", () => {
    vi.stubEnv("CORTEX_PRICING_JSON", '{"modelo-propio":{"in":1,"out":2},"x-ai/grok-4.5":{"in":0,"out":0}}');
    resetPricingCache();
    expect(estimateCostUsd("modelo-propio", 1_000_000, 1_000_000)).toBeCloseTo(3.0, 6);
    expect(estimateCostUsd("x-ai/grok-4.5", 1_000_000, 1_000_000)).toBe(0); // sobreescrito
  });

  it("un JSON inválido se ignora y se sigue usando la tabla de código", () => {
    vi.stubEnv("CORTEX_PRICING_JSON", "{esto no es json");
    resetPricingCache();
    expect(estimateCostUsd("x-ai/grok-4.5", 1_000_000, 0)).toBeCloseTo(2.0, 6);
  });
});

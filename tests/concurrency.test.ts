import { describe, it, expect, afterEach, vi } from "vitest";
import { llmSlotsInFlight, withLlmSlot } from "@cortex/shared";

/**
 * El semáforo existe porque el proveedor limita peticiones EN PARALELO por API key
 * (NaN: 5). Lo que hay que garantizar es que nunca se superan N en vuelo aunque se
 * lancen muchas a la vez, y que un fallo no deja el slot pillado (si lo hiciera, el
 * pipeline se quedaría clavado tras el primer error).
 */
afterEach(() => {
  vi.unstubAllEnvs();
});

/** Tarea que registra el pico de concurrencia observado. */
function tracker() {
  const state = { active: 0, peak: 0 };
  return {
    state,
    task: async () => {
      state.active++;
      state.peak = Math.max(state.peak, state.active);
      await new Promise((r) => setTimeout(r, 5));
      state.active--;
    },
  };
}

describe("withLlmSlot", () => {
  it("no supera el límite configurado con muchas llamadas simultáneas", async () => {
    vi.stubEnv("CORTEX_LLM_CONCURRENCY", "3");
    const { state, task } = tracker();
    await Promise.all(Array.from({ length: 20 }, () => withLlmSlot(task)));
    expect(state.peak).toBeLessThanOrEqual(3);
    expect(state.peak).toBeGreaterThan(1); // y sí hay paralelismo real
    expect(llmSlotsInFlight()).toBe(0);
  });

  it("serializa con concurrencia 1", async () => {
    vi.stubEnv("CORTEX_LLM_CONCURRENCY", "1");
    const { state, task } = tracker();
    await Promise.all(Array.from({ length: 6 }, () => withLlmSlot(task)));
    expect(state.peak).toBe(1);
  });

  it("libera el slot aunque la llamada falle", async () => {
    vi.stubEnv("CORTEX_LLM_CONCURRENCY", "1");
    await expect(withLlmSlot(async () => { throw new Error("429"); })).rejects.toThrow("429");
    expect(llmSlotsInFlight()).toBe(0);
    // Y la siguiente llamada no se queda esperando un slot que nunca vuelve.
    await expect(withLlmSlot(async () => "ok")).resolves.toBe("ok");
  });

  it("un valor inválido de la env no deja el cupo en cero", async () => {
    vi.stubEnv("CORTEX_LLM_CONCURRENCY", "0");
    await expect(withLlmSlot(async () => "ok")).resolves.toBe("ok");
  });
});

import { describe, it, expect, afterEach, vi } from "vitest";
import { llmSlotsInFlight, withLlmSlot } from "@cortex/shared";

/**
 * The semaphore exists because the provider caps requests IN PARALLEL per API key. What has
 * to be guaranteed is that N in flight is never exceeded even when many are fired at once,
 * and that a failure does not leave a slot stuck (if it did, the pipeline would seize up
 * after the first error).
 */
afterEach(() => {
  vi.unstubAllEnvs();
});

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
  it("does not exceed the configured limit with many simultaneous calls", async () => {
    vi.stubEnv("CORTEX_LLM_CONCURRENCY", "3");
    const { state, task } = tracker();
    await Promise.all(Array.from({ length: 20 }, () => withLlmSlot(task)));
    expect(state.peak).toBeLessThanOrEqual(3);
    expect(state.peak).toBeGreaterThan(1); // and there really is parallelism
    expect(llmSlotsInFlight()).toBe(0);
  });

  it("serializa con concurrencia 1", async () => {
    vi.stubEnv("CORTEX_LLM_CONCURRENCY", "1");
    const { state, task } = tracker();
    await Promise.all(Array.from({ length: 6 }, () => withLlmSlot(task)));
    expect(state.peak).toBe(1);
  });

  it("releases the slot even when the call fails", async () => {
    vi.stubEnv("CORTEX_LLM_CONCURRENCY", "1");
    await expect(withLlmSlot(async () => { throw new Error("429"); })).rejects.toThrow("429");
    expect(llmSlotsInFlight()).toBe(0);
    // And the next call does not sit waiting for a slot that never comes back.
    await expect(withLlmSlot(async () => "ok")).resolves.toBe("ok");
  });

  it("an invalid env value does not leave the budget at zero", async () => {
    vi.stubEnv("CORTEX_LLM_CONCURRENCY", "0");
    await expect(withLlmSlot(async () => "ok")).resolves.toBe("ok");
  });
});

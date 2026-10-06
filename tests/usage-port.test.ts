import { describe, it, expect, afterEach } from "vitest";
import { configureCore, recordUsage, resetCore } from "../packages/core/src/index";
import type { UsageRepository } from "../packages/core/src/observability/domain/usage";

/**
 * Observability must never break the pipeline it observes: a call is not lost because its cost
 * could not be written.
 */
describe("recording usage", () => {
  afterEach(() => resetCore());

  it("never throws, even when the adapter fails", async () => {
    const failing = { record: async () => { throw new Error("database down"); } } as unknown as UsageRepository;
    configureCore({ usage: failing });

    await expect(recordUsage({ provider: "p", model: "m", operation: "o" })).resolves.toBeUndefined();
  });

  it("hands the adapter the rounded tokens and the estimated cost", async () => {
    const recorded: unknown[] = [];
    configureCore({ usage: { record: async (e: unknown) => void recorded.push(e) } as unknown as UsageRepository });

    await recordUsage({ provider: "openai", model: "gpt-4o", operation: "o", inputTokens: 999.6, outputTokens: 0 });
    expect(recorded).toEqual([
      expect.objectContaining({ kind: "llm", inputTokens: 1000, outputTokens: 0, totalTokens: 1000, costUsd: 0.0025, project: null }),
    ]);
  });
});

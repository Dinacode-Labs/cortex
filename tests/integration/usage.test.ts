import { describe, it, expect, afterAll } from "vitest";
import { closeSql } from "@cortex/database";
import { getUsageSummary, recordUsage } from "@cortex/core";

const RID = Math.random().toString(36).slice(2, 8);

afterAll(async () => {
  await closeSql();
});

/**
 * The usage page is the only place the cost of the models shows up; a call recorded but not
 * summarised, or summarised at the wrong price, goes unnoticed until the bill arrives.
 */
describe("usage goes through its port and comes back summarised", () => {
  it("a recorded call shows up in the summary, with its tokens and its estimated cost", async () => {
    const operation = `it-usage-${RID}`;
    await recordUsage({ provider: "openai", model: "gpt-4o-mini", operation, inputTokens: 1_000_000, outputTokens: 1_000_000 });

    const row = (await getUsageSummary()).byOperation.find((o) => o.operation === operation);
    expect(row).toMatchObject({ kind: "llm", calls: 1, totalTokens: 2_000_000 });
    expect(row!.costUsd).toBeCloseTo(0.75);
  });
});

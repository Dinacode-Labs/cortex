import { describe, it, expect, afterAll } from "vitest";
import { closeSql } from "@cortex/database";
import { createProject, getUsageFacets, getUsageSummary, recordUsage } from "@cortex/core";

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

/**
 * The spend split by project, by subscription and by day (ADR-0100). A filter the summary ignores
 * shows the whole installation's bill under one project's name, which is worse than no filter.
 */
describe("usage filtered by project, subscription and period", () => {
  const endpoint = `usage-${RID}.example`;

  it("counts, for a project, only what was spent on it, and says whose it is", async () => {
    const project = await createProject(`Usage ${RID}`);
    await recordUsage({ provider: "openai-compatible", model: "m", operation: "classifier", projectId: project.id, endpoint, inputTokens: 300, outputTokens: 30 });
    await recordUsage({ provider: "openai-compatible", model: "m", operation: "classifier", endpoint, inputTokens: 5 });

    const summary = await getUsageSummary({ projectId: project.id });

    expect(summary.totals).toMatchObject({ calls: 1, inputTokens: 300, outputTokens: 30, totalTokens: 330 });
    expect(summary.byProject).toEqual([expect.objectContaining({ projectId: project.id, name: project.name, slug: project.slug, totalTokens: 330 })]);
    expect(summary.daily.at(-1)).toMatchObject({ calls: 1, totalTokens: 330 });
    expect((await getUsageFacets()).projects).toContainEqual({ id: project.id, name: project.name, slug: project.slug });
  });

  it("counts, for a subscription, every call that went to its host and nothing else", async () => {
    const summary = await getUsageSummary({ endpoint });

    expect(summary.totals).toMatchObject({ calls: 2, totalTokens: 335 });
    expect(summary.byEndpoint).toEqual([expect.objectContaining({ endpoint, providers: ["openai-compatible"], calls: 2 })]);
    expect(summary.byProject.map((p) => p.totalTokens).sort((a, b) => a - b)).toEqual([5, 330]);
    expect((await getUsageFacets()).endpoints).toContain(endpoint);
  });

  it("leaves out what was spent before the period began, and still draws every day of it", async () => {
    const summary = await getUsageSummary({ endpoint, days: 7, now: new Date(Date.now() + 30 * 86_400_000) });

    expect(summary.totals.calls).toBe(0);
    expect(summary.daily).toHaveLength(7);
    expect(summary.daily.every((d) => d.totalTokens === 0)).toBe(true);
  });
});

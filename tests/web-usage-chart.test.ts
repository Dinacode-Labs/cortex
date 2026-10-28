import { describe, it, expect } from "vitest";
import type { UsageDay } from "../packages/core/src/observability/domain/usage";
import { dailyTokensChart, niceCeiling } from "../apps/web/src/views/usage";

const day = (date: string, totalTokens: number): UsageDay => ({
  day: date,
  calls: totalTokens ? 1 : 0,
  inputTokens: totalTokens,
  outputTokens: 0,
  totalTokens,
  costUsd: 0,
});

/**
 * The axis labels its top and its half. A top of 2,500 labels its half 1.3K, which is not what the
 * gridline marks.
 */
describe("the top of the usage chart's axis", () => {
  it("is the next 1, 2 or 5 of the busiest day's magnitude", () => {
    expect([1234, 5000, 5001, 7].map(niceCeiling)).toEqual([2000, 5000, 10000, 10]);
  });

  it("is one on a period with no calls, so nothing divides by zero", () => {
    expect(niceCeiling(0)).toBe(1);
  });
});

/**
 * The chart is what an admin reads the spend from (ADR-0100): a day that spent a little next to
 * one that spent a lot has to stay visible, and a day that spent nothing has to read as nothing.
 */
describe("the daily tokens chart", () => {
  const painted = String(dailyTokensChart([day("2026-10-25", 1000), day("2026-10-26", 0), day("2026-10-27", 1)]));

  it("draws a bar for every day of the period, idle days included", () => {
    expect([...painted.matchAll(/--bar-height:([\d.]+)%/g)].map((m) => m[1])).toEqual(["100", "0", "1"]);
  });

  it("says each day's figures on hover", () => {
    expect(painted).toContain('title="Oct 25 · 1,000 tokens (1,000 in, 0 out) · 1 call"');
  });

  it("says the same in a table, newest first", () => {
    const rows = [...painted.matchAll(/<tr><td>(\w+ \d+)<\/td>/g)].map((m) => m[1]);
    expect(rows).toEqual(["Oct 27", "Oct 26", "Oct 25"]);
  });
});

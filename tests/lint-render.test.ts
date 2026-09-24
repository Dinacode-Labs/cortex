import { describe, it, expect } from "vitest";
import { renderLintReport, type LintReport } from "../packages/core/src/knowledge/lint.js";

/**
 * `neverReviewed` is the largest finding in almost any project -- in a real one, 348 out of
 * 348 -- and it was computed, typed and documented while the Markdown report (the CLI and the
 * `lint_project_context` MCP tool) never printed it. A number nobody can see is a number
 * nobody acts on.
 */
const report = (over: Partial<LintReport> = {}): LintReport => ({
  project: "Demo",
  totalEntries: 348,
  contradictions: [],
  duplicates: [],
  orphanEntities: [],
  lowConfidence: 7,
  staleHistorical: 3,
  neverReviewed: 348,
  gaps: [],
  ...over,
});

describe("the lint report as Markdown", () => {
  it("prints how many entries nobody has ever reviewed, under 'Other'", () => {
    const md = renderLintReport(report());
    const lines = md.split("\n");
    const other = lines.findIndex((l) => l.startsWith("## 📉 Other"));
    expect(other).toBeGreaterThan(-1);
    const never = lines.findIndex((l) => /never reviewed/i.test(l));
    expect(never).toBeGreaterThan(other);
    expect(lines[never]).toContain("348 of 348");
  });

  it("prints the zero too: 'nobody has reviewed anything' and 'everything is reviewed' must be told apart", () => {
    const md = renderLintReport(report({ neverReviewed: 0 }));
    expect(md).toMatch(/never reviewed by a person: 0 of 348/i);
  });
});

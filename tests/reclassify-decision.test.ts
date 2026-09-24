import { describe, it, expect } from "vitest";
import { decideReclassification } from "../packages/core/src/knowledge/save.js";

/**
 * `maintain` reclassified every heuristically typed entry and wrote the result back even when
 * the classifier returned the type the entry already had. That UPDATE moved `updated_at`
 * through the `set_updated_at` trigger, and auto-curation -- running minutes later in the same
 * pass -- read the movement as proof the knowledge had recurred in another session. Practically
 * every distilled entry was promoted to medium without anybody ever confirming it (ADR-0067).
 */
describe("what a reclassification pass does with one entry", () => {
  it("does not write when the classifier returns the type the entry already had", () => {
    expect(decideReclassification("decision", "decision")).toBe("confirmed");
  });

  it("writes when the type really changes", () => {
    expect(decideReclassification("incident", "decision")).toBe("retype");
  });

  it("leaves the entry alone when the classifier answered nothing, so the next pass retries it", () => {
    expect(decideReclassification("decision", undefined)).toBe("unclassified");
    expect(decideReclassification("decision", null)).toBe("unclassified");
  });
});

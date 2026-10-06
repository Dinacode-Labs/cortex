import { describe, it, expect } from "vitest";
import { entityType, extractableEntityType, isUsableEntityName } from "../packages/core/src/graph/domain/entity";

/**
 * An entity is a THING THAT HAS A NAME, not a claim about the project.
 *
 * When `entityType` accepted `decision` and `incident` -- which are entry types -- the
 * extractor created nodes whose name was the whole sentence, duplicating in the graph what was
 * already in the memory. In a real installation: 222 nodes like that, and all 18 contradictions
 * detected were between node names, none between entries. See ADR-0055.
 */
describe("what can be an entity", () => {
  it("entry types are not entity types", () => {
    for (const t of ["decision", "incident"]) {
      expect(entityType.options as readonly string[], `"${t}" would duplicate entries in the graph`).not.toContain(t);
    }
  });

  it("`project` is an entity type, but it is not offered to the extractor: a project is created, not extracted (#135)", () => {
    expect(entityType.options).toContain("project");
    expect(extractableEntityType.options as readonly string[]).not.toContain("project");
    // And none of the others is missing: removing `project` is all it does.
    expect([...extractableEntityType.options, "project"].sort()).toEqual([...entityType.options].sort());
  });

  it("real names get through", () => {
    for (const n of ["OkHttpClient", "src/queue.ts", "Stripe", "payments module", "GitLab CI"]) {
      expect(isUsableEntityName(n), n).toBe(true);
    }
  });

  it("sentences are not", () => {
    for (const n of [
      "Do not assume source paths in the target",
      "Publish Cortex openly and monetise the implementation",
      "Non-aggressive communication towards the client.",
    ]) {
      expect(isUsableEntityName(n), n).toBe(false);
    }
  });

  it("nor are deictics: they name nothing on their own", () => {
    for (const n of ["opción C", "opción A", "la opción b", "v3", "caso 2", "fase 1"]) { // Spanish on purpose: the corpus is Spanish
      expect(isUsableEntityName(n), n).toBe(false);
    }
  });

  it("nor are English deictics, while names that only start like one get through", () => {
    for (const n of ["option C", "the alternative b", "an option", "case 2", "step 3", "step3", "phase"]) {
      expect(isUsableEntityName(n), n).toBe(false);
    }
    for (const n of ["Casey", "Step Functions", "Option Pricing Service", "Point of Sale"]) {
      expect(isUsableEntityName(n), n).toBe(true);
    }
  });

  it("nor is anything too short or without letters", () => {
    for (const n of ["ab", "  ", "42", "—"]) expect(isUsableEntityName(n), JSON.stringify(n)).toBe(false);
  });
});

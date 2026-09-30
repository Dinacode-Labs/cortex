import { describe, it, expect } from "vitest";
import { entityGroupKey, rankEntities } from "../packages/core/src/graph/domain/entity.js";

/**
 * Which spellings of an entity collapse into one, and which one survives, is the rule that used
 * to live as a comparator inside a transaction. It is pure now (ADR-0076).
 */
describe("which entity variants collapse, and into which one", () => {
  it("groups by type and normalised name, so different types stay apart", () => {
    expect(entityGroupKey("vendor", "Stripe")).toBe(entityGroupKey("vendor", "stripe"));
    expect(entityGroupKey("vendor", "Stripe")).not.toBe(entityGroupKey("service", "Stripe"));
  });

  it("treats a name that says nothing as no group at all", () => {
    expect(entityGroupKey("technology", "v3")).toBeNull();
    expect(entityGroupKey("technology", "a")).toBeNull();
  });

  it("picks the entity with more links as canonical", () => {
    const ranked = rankEntities([
      { id: "b", name: "Acme", linkCount: 1 },
      { id: "a", name: "Acme Corp", linkCount: 5 },
    ]);
    expect(ranked[0]).toEqual({ id: "a", name: "Acme Corp", linkCount: 5 });
  });

  it("breaks a link tie by the more descriptive name", () => {
    const ranked = rankEntities([
      { id: "a", name: "Acme", linkCount: 2 },
      { id: "b", name: "Acme Corporation", linkCount: 2 },
    ]);
    expect(ranked[0]!.name).toBe("Acme Corporation");
  });

  it("is deterministic when everything ties, by id", () => {
    const ranked = rankEntities([
      { id: "zzz", name: "Acme", linkCount: 0 },
      { id: "aaa", name: "Acme", linkCount: 0 },
    ]);
    expect(ranked.map((e) => e.id)).toEqual(["aaa", "zzz"]);
  });
});

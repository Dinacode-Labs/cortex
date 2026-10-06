import { describe, it, expect } from "vitest";
import { PACK_SECTIONS, type ContextPack } from "../packages/core/src/knowledge/context-pack.js";
import { renderContextPack } from "../packages/core/src/knowledge/render.js";
import type { ProjectCriteria } from "../packages/shared/src/index";

const memo = (type: string, i: number) => ({
  id: `${type}-${i}`,
  title: `${type} ${i}`,
  content: "x".repeat(300),
  summary: "y".repeat(180),
  type,
  status: "pending_validation",
  confidence: "medium",
});

const pack = (criteria?: ProjectCriteria): ContextPack =>
  ({
    project: "Demo",
    totalEntries: 400,
    generatedAt: new Date("2026-10-06T00:00:00Z"),
    criteria,
    sections: PACK_SECTIONS.map((s) => ({ ...s, entries: Array.from({ length: 12 }, (_, i) => memo(s.type, i)) })),
    sensitiveModules: [],
    relevantToArea: [],
    conflicts: [],
  }) as unknown as ContextPack;

const narrowed: ProjectCriteria = {
  types: { how_to: { keep: false }, decision: { keep: true, guidance: "only those that change the public API" } },
  keep: ["deadlines agreed with the client"],
  discard: ["problems of a developer's local environment"],
};

/**
 * The distiller follows a project's criteria, but the agents that save by hand only learn them
 * from the pack (ADR-0084): without this line they keep saving what the project discards.
 */
describe("the pack tells the agent what the project keeps", () => {
  it("says it in the header, with the discarded types, what counts as each one and both lists", () => {
    const header = renderContextPack(pack(narrowed)).split("\n## ")[0]!;

    expect(header).toContain(
      "> **What this project keeps:** do not save how_to · decision: only those that change the public API · " +
        "always save deadlines agreed with the client · never save problems of a developer's local environment.",
    );
  });

  it("keeps saying it when the pack is cut to a small budget", () => {
    expect(renderContextPack(pack(narrowed), { maxChars: 1500 })).toContain("What this project keeps");
  });

  it("says nothing when the project narrows nothing", () => {
    const untouched = { types: {}, keep: [], discard: [] };
    expect({
      none: renderContextPack(pack()).includes("What this project keeps"),
      empty: renderContextPack(pack(untouched)).includes("What this project keeps"),
    }).toEqual({ none: false, empty: false });
  });
});

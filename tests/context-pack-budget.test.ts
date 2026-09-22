import { describe, it, expect } from "vitest";
import { renderContextPack } from "../packages/core/src/render.js";
import type { ContextPack } from "../packages/core/src/context-pack.js";
import type { ContextEntry } from "@cortex/shared";

/**
 * The hook injects the pack when a session starts, and there is a character cap. When the pack
 * was cut with a `slice()` at the end, a project with two hundred entries sent the agent its
 * decisions and NOTHING ELSE: constraints, risks and debt fell outside the scissors with nobody
 * the wiser. The agent believes it has seen the project's memory and has seen a third of it.
 */
function entry(kind: string, i: number): ContextEntry {
  return {
    id: `${kind}-${i}`,
    title: `${kind} number ${i}`,
    content: "x".repeat(400),
    summary: "y".repeat(400),
    type: kind,
    status: "active",
    confidence: "medium",
  } as unknown as ContextEntry;
}

const list = (kind: string, n: number) => Array.from({ length: n }, (_, i) => entry(kind, i));

const SECTIONS: [string, string, number, number][] = [
  ["decision", "Decisions in force", 2, 20],
  ["constraint", "Active constraints", 2, 8],
  ["risk", "Known risks", 2, 6],
  ["technical_debt", "Technical debt", 2, 5],
  ["convention", "Conventions", 2, 4],
];

const pack = (): ContextPack =>
  ({
    project: "Epic",
    totalEntries: 200,
    generatedAt: new Date("2026-09-15T00:00:00Z"),
    sections: SECTIONS.map(([type, title, weight, n]) => ({ type, title, weight, entries: list(type, n) })),
    sensitiveModules: ["payments", "auth"],
    relevantToArea: [],
    conflicts: [],
  }) as unknown as ContextPack;

describe("renderContextPack with a budget", () => {
  it("with no cap, the pack comes out whole", () => {
    const txt = renderContextPack(pack());
    expect(txt).toContain("decision number 19");
    expect(txt).toContain("constraint number 7");
  });

  it("with a cap, EVERY section arrives (only the decisions used to)", () => {
    const txt = renderContextPack(pack(), { maxChars: 6000 });
    for (const t of ["Decisions in force", "Active constraints", "Known risks", "Technical debt", "Conventions"]) {
      expect(txt, `the "${t}" section is missing`).toContain(`## ${t}`);
    }
    // And real content arrives from each of them, not just the title.
    for (const t of ["decision number", "constraint number", "risk number", "technical_debt number", "convention number"]) {
      expect(txt, `the ${t} section arrived empty`).toContain(t);
    }
  });

  it("it respects the cap", () => {
    expect(renderContextPack(pack(), { maxChars: 6000 }).length).toBeLessThanOrEqual(6000);
    expect(renderContextPack(pack(), { maxChars: 2000 }).length).toBeLessThanOrEqual(2000);
  });

  it("says how much was left out instead of keeping quiet about it", () => {
    expect(renderContextPack(pack(), { maxChars: 6000 })).toMatch(/\*\*\+\d+ more\*\* not shown/);
  });

  it("never goes over the cap, however you ask for it", () => {
    for (const cap of [500, 1000, 2000, 3000, 6000, 12000, 20000, 40000]) {
      expect(renderContextPack(pack(), { maxChars: cap }).length, `cap ${cap}`).toBeLessThanOrEqual(cap);
    }
  });

  it("what one section does not spend is shared out: a small one takes no extra room", () => {
    const p = pack();
    (p as { sensitiveModules: string[] }).sensitiveModules = ["payments"]; // a tiny section
    const txt = renderContextPack(p, { maxChars: 6000 });
    expect(txt).toContain("- payments");
    expect(txt).not.toMatch(/## Sensitive modules[\s\S]*more\*\* not shown/);
  });
});

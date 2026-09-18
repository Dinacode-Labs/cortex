import { describe, it, expect } from "vitest";
import { PACK_SECTIONS } from "../packages/core/src/context-pack.js";
import { renderContextPack } from "../packages/core/src/render.js";
import { stripLeadingTitle } from "../packages/core/src/text.js";
import { contextEntryType } from "@cortex/shared";
import type { ContextPack } from "../packages/core/src/context-pack.js";
import type { ContextEntry } from "@cortex/shared";

/**
 * ADR-0054: the pack covers all the knowledge that describes the project's STATE, not the five
 * types somebody once hand-wrote into an interface.
 */
const entrada = (tipo: string, i: number): ContextEntry =>
  ({
    id: `${tipo}-${i}`,
    title: `${tipo} ${i}`,
    content: "x".repeat(300),
    summary: "y".repeat(180),
    type: tipo,
    status: "active",
    confidence: "medium",
  }) as unknown as ContextEntry;

const pack = (): ContextPack =>
  ({
    project: "Demo",
    totalEntries: 400,
    generatedAt: new Date("2026-09-16T00:00:00Z"),
    sections: PACK_SECTIONS.map((s) => ({
      ...s,
      entries: Array.from({ length: 12 }, (_, i) => entrada(s.type, i)),
    })),
    sensitiveModules: [],
    relevantToArea: [],
    conflicts: [],
  }) as unknown as ContextPack;

describe("which types reach the agent", () => {
  it("the types that describe the project's state are in the pack", () => {
    const inPack = new Set(PACK_SECTIONS.map((s) => s.type));
    for (const t of ["decision", "constraint", "risk", "technical_debt", "convention",
                     "architecture", "business_rule", "incident", "integration_note",
                     "module_note", "how_to"]) {
      expect(inPack.has(t as never), `"${t}" reaches no agent at all`).toBe(true);
    }
  });

  it("only the ones that record an event are left out, and deliberately so", () => {
    const fuera = contextEntryType.options.filter((t) => !PACK_SECTIONS.some((s) => s.type === t));
    expect(fuera.sort()).toEqual(["meeting_summary", "pr_summary", "ticket_resolution"]);
  });

  it("with a budget something from every section arrives, and those governing the work carry more", () => {
    const txt = renderContextPack(pack(), { maxChars: 6000 });
    for (const s of PACK_SECTIONS) {
      expect(txt, `falta "${s.title}"`).toContain(`## ${s.title}`);
      expect(txt, `"${s.title}" arrived with no content`).toContain(`${s.type} 0`);
    }
    const cuenta = (tipo: string) => (txt.match(new RegExp(`\\*\\*${tipo} \\d+\\*\\*`, "g")) ?? []).length;
    expect(cuenta("decision")).toBeGreaterThan(cuenta("how_to"));
  });

  it("never goes over the cap", () => {
    for (const tope of [1500, 3000, 6000, 12000, 30000]) {
      expect(renderContextPack(pack(), { maxChars: tope }).length, `tope ${tope}`).toBeLessThanOrEqual(tope);
    }
  });
});

describe("the summary does not repeat the title", () => {
  it("strips it when the summary starts with it", () => {
    const t = "Exporting native PDF from Figma avoids the rate limit";
    const s = `${t} Right-click the page in the Figma app and export every frame.`;
    expect(stripLeadingTitle(s, t)).toBe("Right-click the page in the Figma app and export every frame.");
  });

  it("tolerates punctuation and casing, which is how it really arrives", () => {
    expect(stripLeadingTitle("Queue with 3 retries: the queue now has a cap of three and a configured DLQ.", "queue with 3 retries"))
      .toBe("the queue now has a cap of three and a configured DLQ.");
  });

  it("when stripping leaves no summary, it is left as it was", () => {
    const t = "A decision about the queue";
    expect(stripLeadingTitle(`${t} and little else.`, t)).toBe(`${t} and little else.`);
  });

  it("does not touch a summary that does not start with the title", () => {
    expect(stripLeadingTitle("The queue now has a cap.", "Retries")).toBe("The queue now has a cap.");
  });
});

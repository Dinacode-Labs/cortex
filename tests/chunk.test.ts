import { describe, it, expect } from "vitest";
import { chunkDocument } from "../packages/shared/src/chunk.js";

/**
 * The structural chunker (ADR-0023, phase 1) unblocks ingesting long documents: a doc used to
 * enter as 1 entry / 1 truncated vector; it is now split into bounded fragments referring back
 * to the parent. These tests pin the contract: bounded size, a short doc = 1 chunk, overlap
 * between chunks, and robustness against giant paragraphs / empty text.
 */
describe("chunkDocument", () => {
  it("empty text → no chunks", () => {
    expect(chunkDocument("")).toEqual([]);
    expect(chunkDocument("   \n\n  ")).toEqual([]);
  });

  it("short document → a single chunk with no overlap", () => {
    const r = chunkDocument("# Decision\n\nRabbitMQ is used for asynchronous exports.");
    expect(r).toHaveLength(1);
    expect(r[0].index).toBe(0);
    expect(r[0].total).toBe(1);
    expect(r[0].content).toContain("RabbitMQ");
    expect(r[0].content.startsWith("…")).toBe(false); // the first one never carries overlap
    expect(r[0].section).toBe("Decision");
  });

  it("long document → several chunks, all within the cap", () => {
    const para = "Lorem ipsum dolor sit amet consectetur adipiscing elit. ".repeat(30); // ~1650 chars
    const doc = Array.from({ length: 12 }, (_, i) => `## Section ${i}\n\n${para}`).join("\n\n");
    const r = chunkDocument(doc, { targetChars: 2000, maxChars: 2500, overlapChars: 200 });
    expect(r.length).toBeGreaterThan(1);
    for (const c of r) expect(c.content.length).toBeLessThanOrEqual(2500 + 200 + 2);
    r.forEach((c, i) => { expect(c.index).toBe(i); expect(c.total).toBe(r.length); });
  });

  it("later chunks carry an overlap from the previous one", () => {
    const para = "Filler sentence number one, long enough to force the cut. ".repeat(20);
    const r = chunkDocument(para, { targetChars: 800, maxChars: 1000, overlapChars: 150 });
    expect(r.length).toBeGreaterThan(1);
    expect(r[1].content.startsWith("…")).toBe(true);
  });

  it("a giant paragraph with no punctuation is hard-cut without exceeding the cap", () => {
    const monster = "x".repeat(12000);
    const r = chunkDocument(monster, { targetChars: 2000, maxChars: 2500, overlapChars: 0 });
    expect(r.length).toBeGreaterThan(1);
    for (const c of r) expect(c.content.length).toBeLessThanOrEqual(2500);
  });

  it("tracks the Markdown heading in force for each chunk", () => {
    const big = "Filler content to fill the section. ".repeat(60); // ~2700 chars
    const doc = `# Alfa\n\n${big}\n\n## Beta\n\n${big}`;
    const r = chunkDocument(doc, { targetChars: 2000, maxChars: 2600, overlapChars: 0 });
    expect(r[0].section).toBe("Alfa");
    expect(r.some((c) => c.section === "Beta")).toBe(true);
  });
});

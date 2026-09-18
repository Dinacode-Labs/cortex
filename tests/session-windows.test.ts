import { describe, it, expect } from "vitest";
import { sliceTranscript, windows } from "../packages/client/src/transcript-utils.js";

/**
 * A session that does not fit whole into the distillation always used to lose its ending.
 *
 * The slicing cut off on reaching the window cap, so out of a 128,000-character session the
 * first 72,000 were distilled and the rest thrown away -- and in a working session the
 * conclusions are at the end. On top of that the capture finished as `done` with its counters,
 * identical to one that did fit: nothing said half of it was missing.
 */
const session = (turns: number, perTurn = 1000) =>
  Array.from({ length: turns }, (_, i) => `TURNO-${i} ` + "x".repeat(perTurn)).join("\n\n");

describe("slicing a session", () => {
  it("a session that fits whole loses nothing", () => {
    const { windows: slices, dropped } = sliceTranscript(session(10));
    expect(dropped).toBe(0);
    expect(slices.join("\n\n")).toContain("TURNO-9");
  });

  it("when it does not fit, the END still arrives", () => {
    const t = session(200); // ~200,000 characters: far above the cap
    const { windows: slices, dropped } = sliceTranscript(t);
    expect(dropped).toBeGreaterThan(0);
    const text = slices.join("\n\n");
    expect(text, "the start must be there").toContain("TURNO-0");
    expect(text, "the close is where the conclusions are").toContain("TURNO-199");
  });

  it("and so does the middle, spread out, not just the extremes", () => {
    const { windows: slices } = sliceTranscript(session(200));
    const indices = slices
      .map((v) => Number(v.match(/TURNO-(\d+)/)![1]))
      .sort((a, b) => a - b);
    expect(indices.length).toBeGreaterThan(2);
    // Neither all at the start nor all at the end: the whole run is covered.
    expect(indices[Math.floor(indices.length / 2)]).toBeGreaterThan(50);
    expect(indices[Math.floor(indices.length / 2)]).toBeLessThan(150);
  });

  it("says how much was left out, instead of keeping quiet about it", () => {
    const t = session(200);
    const { windows: slices, dropped } = sliceTranscript(t);
    const used = slices.reduce((n, v) => n + v.length, 0);
    // What was dropped plus what was used adds up to the whole session (± window separators).
    expect(dropped + used).toBeGreaterThan(t.length * 0.95);
  });

  it("`windows` still returns what it always did, for callers who only want the text", () => {
    expect(windows(session(5))).toEqual(sliceTranscript(session(5)).windows);
  });
});

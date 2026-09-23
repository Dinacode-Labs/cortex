import { describe, it, expect } from "vitest";
import { dateBlockOf, groupByDate, parseDateGrouping } from "../apps/web/src/date-blocks.js";

/**
 * The Memory list sorted by date is cut into day, week, month or year blocks. A boundary off by
 * one puts an entry under the wrong heading, which reads as a false claim about when it was
 * written; a block cut by the page limit with an honest-looking count reads as "that was all".
 */
const at = (iso: string): Date => new Date(iso);
const dates = (...isos: string[]): Date[] => isos.map(at);
const keysOf = (blocks: { key: string; items: unknown[] }[]) => blocks.map((b) => `${b.key}:${b.items.length}`);

describe("the date block an entry falls in", () => {
  it("a day is a UTC day, whatever zone the server runs in", () => {
    expect(dateBlockOf(at("2026-09-23T23:59:59.999Z"), "day")).toEqual({ key: "2026-09-23", label: "23 September 2026" });
    expect(dateBlockOf(at("2026-09-24T00:00:00.000Z"), "day").key).toBe("2026-09-24");
  });

  it("a week starts on Monday, and Sunday still belongs to the week before", () => {
    expect(dateBlockOf(at("2026-09-21T00:00:00Z"), "week")).toEqual({
      key: "2026-09-21",
      label: "Week of 21 September 2026",
    });
    expect(dateBlockOf(at("2026-09-27T23:59:59Z"), "week").key).toBe("2026-09-21");
    expect(dateBlockOf(at("2026-09-28T00:00:00Z"), "week").key).toBe("2026-09-28");
  });

  it("a week that crosses New Year is one block, named after its Monday", () => {
    expect(dateBlockOf(at("2026-01-01T12:00:00Z"), "week")).toEqual({
      key: "2025-12-29",
      label: "Week of 29 December 2025",
    });
    expect(dateBlockOf(at("2025-12-29T00:00:00Z"), "week").key).toBe("2025-12-29");
  });

  it("months and years cut at the UTC boundary", () => {
    expect(dateBlockOf(at("2026-09-30T23:59:59Z"), "month")).toEqual({ key: "2026-09", label: "September 2026" });
    expect(dateBlockOf(at("2026-10-01T00:00:00Z"), "month").key).toBe("2026-10");
    expect(dateBlockOf(at("2025-12-31T23:59:59Z"), "year")).toEqual({ key: "2025", label: "2025" });
    expect(dateBlockOf(at("2026-01-01T00:00:00Z"), "year").key).toBe("2026");
  });

  it("an unknown grouping in the URL falls back to the default instead of failing", () => {
    expect(parseDateGrouping("fortnight")).toBe("day");
    expect(parseDateGrouping(undefined)).toBe("day");
    expect(parseDateGrouping("month")).toBe("month");
  });
});

describe("grouping a sorted list into blocks", () => {
  const byDate = (d: Date) => d;

  it("newest first gives the newest block first", () => {
    const items = dates("2026-09-23T10:00Z", "2026-09-23T08:00Z", "2026-09-22T09:00Z", "2026-08-31T09:00Z");
    expect(keysOf(groupByDate(items, { grouping: "day", dateOf: byDate }))).toEqual([
      "2026-09-23:2",
      "2026-09-22:1",
      "2026-08-31:1",
    ]);
  });

  it("oldest first gives the oldest block first", () => {
    const items = dates("2026-08-31T09:00Z", "2026-09-22T09:00Z", "2026-09-23T08:00Z");
    expect(keysOf(groupByDate(items, { grouping: "month", dateOf: byDate }))).toEqual(["2026-08:1", "2026-09:2"]);
  });

  it("a block the limit cuts in half says so, and one that ends at the limit does not", () => {
    const items = dates("2026-09-23T10:00Z", "2026-09-22T10:00Z", "2026-09-22T09:00Z", "2026-09-21T09:00Z");

    const cut = groupByDate(items, { grouping: "day", dateOf: byDate, limit: 2 });
    expect(keysOf(cut)).toEqual(["2026-09-23:1", "2026-09-22:1"]);
    expect(cut.map((b) => b.truncated)).toEqual([false, true]);

    const whole = groupByDate(items, { grouping: "day", dateOf: byDate, limit: 3 });
    expect(keysOf(whole)).toEqual(["2026-09-23:1", "2026-09-22:2"]);
    expect(whole.map((b) => b.truncated)).toEqual([false, false]);
  });

  it("with nothing beyond the limit no block is cut", () => {
    const items = dates("2026-09-23T10:00Z", "2026-09-23T09:00Z");
    expect(groupByDate(items, { grouping: "year", dateOf: byDate, limit: 5 }).map((b) => b.truncated)).toEqual([false]);
  });
});

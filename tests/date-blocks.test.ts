import { describe, it, expect } from "vitest";
import {
  dateBlockOf,
  dateBlockValue,
  groupByDate,
  parseDateBlock,
  parseDateGrouping,
  type BlockGrouping,
} from "../apps/web/src/date-blocks.js";

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

/*
 * Ticking a block purges every memo in its span, past the page included (ADR-0087). A span that
 * ended a millisecond early or late would leave the last memo of the day behind or take the first
 * one of the next.
 */
describe("the span a ticked block purges", () => {
  const groupings: BlockGrouping[] = ["day", "week", "month", "year"];
  const samples = dates("2026-09-23T13:45Z", "2026-01-01T00:00Z", "2025-12-31T23:59:59.999Z", "2024-02-29T12:00Z");

  it("holds every instant of its block, and ends exactly where the next block begins", () => {
    const wrong: string[] = [];
    for (const grouping of groupings) {
      for (const date of samples) {
        const { key } = dateBlockOf(date, grouping);
        const span = parseDateBlock(dateBlockValue(grouping, key));
        const where = `${grouping} ${date.toISOString()}`;
        if (!span) {
          wrong.push(`${where}: refused its own key`);
          continue;
        }
        if (!(span.from <= date && date < span.to)) wrong.push(`${where}: outside ${span.from.toISOString()}..${span.to.toISOString()}`);
        if (dateBlockOf(span.from, grouping).key !== key) wrong.push(`${where}: starts in another block`);
        if (dateBlockOf(new Date(span.to.getTime() - 1), grouping).key !== key) wrong.push(`${where}: ends early`);
        if (dateBlockOf(span.to, grouping).key === key) wrong.push(`${where}: ends late`);
      }
    }
    expect(wrong).toEqual([]);
  });

  it("a week across New Year and a month at the end of the year end in the next year", () => {
    expect(parseDateBlock("week:2025-12-29")?.to.toISOString()).toBe("2026-01-05T00:00:00.000Z");
    expect(parseDateBlock("month:2026-12")?.to.toISOString()).toBe("2027-01-01T00:00:00.000Z");
    expect(parseDateBlock("year:2026")?.label).toBe("2026");
  });

  it("refuses a block no screen produces, so a hand-written form cannot reach past it", () => {
    const forged = ["day:2026-02-31", "week:2026-09-30", "month:2026-13", "day:2026-9-1", "list:2026", "decade:2020", "week", ""];
    expect(forged.filter((value) => parseDateBlock(value) !== null)).toEqual([]);
  });
});

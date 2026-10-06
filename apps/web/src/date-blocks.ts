export const dateGroupings = ["day", "week", "month", "year", "list"] as const;
export type DateGrouping = (typeof dateGroupings)[number];

export const DEFAULT_DATE_GROUPING: DateGrouping = "day";

export function parseDateGrouping(value: string | undefined): DateGrouping {
  return dateGroupings.find((g) => g === value) ?? DEFAULT_DATE_GROUPING;
}

export type BlockGrouping = Exclude<DateGrouping, "list">;

export interface DateBlock<T> {
  key: string;
  label: string;
  items: T[];
  truncated: boolean;
}

export interface GroupByDateOptions<T> {
  grouping: BlockGrouping;
  dateOf: (item: T) => Date;
  limit?: number;
}

const DAY_MS = 86_400_000;

const dayLabel = new Intl.DateTimeFormat("en-GB", { timeZone: "UTC", day: "numeric", month: "long", year: "numeric" });
const monthLabel = new Intl.DateTimeFormat("en-GB", { timeZone: "UTC", month: "long", year: "numeric" });

function mondayOf(date: Date): Date {
  const midnight = Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate());
  const daysSinceMonday = (date.getUTCDay() + 6) % 7;
  return new Date(midnight - daysSinceMonday * DAY_MS);
}

export function dateBlockOf(date: Date, grouping: BlockGrouping): { key: string; label: string } {
  const iso = date.toISOString();
  switch (grouping) {
    case "day":
      return { key: iso.slice(0, 10), label: dayLabel.format(date) };
    case "week": {
      const monday = mondayOf(date);
      return { key: monday.toISOString().slice(0, 10), label: `Week of ${dayLabel.format(monday)}` };
    }
    case "month":
      return { key: iso.slice(0, 7), label: monthLabel.format(date) };
    case "year":
      return { key: iso.slice(0, 4), label: iso.slice(0, 4) };
  }
}

export function groupByDate<T>(items: T[], opts: GroupByDateOptions<T>): DateBlock<T>[] {
  const limit = opts.limit ?? items.length;
  const blocks: DateBlock<T>[] = [];
  for (const item of items.slice(0, limit)) {
    const { key, label } = dateBlockOf(opts.dateOf(item), opts.grouping);
    const last = blocks.at(-1);
    if (last?.key === key) last.items.push(item);
    else blocks.push({ key, label, items: [item], truncated: false });
  }
  const firstHidden = items[limit];
  const lastShown = blocks.at(-1);
  if (firstHidden !== undefined && lastShown) {
    lastShown.truncated = dateBlockOf(opts.dateOf(firstHidden), opts.grouping).key === lastShown.key;
  }
  return blocks;
}

/** How a whole block travels in a form: `week:2026-09-28`. */
export function dateBlockValue(grouping: BlockGrouping, key: string): string {
  return `${grouping}:${key}`;
}

export interface DateBlockSpan {
  value: string;
  grouping: BlockGrouping;
  key: string;
  label: string;
  /** Half-open: `from` is in the block, `to` is the first instant of the next one. */
  from: Date;
  to: Date;
}

const BLOCK_KEY_SHAPE: Record<BlockGrouping, RegExp> = {
  day: /^\d{4}-\d{2}-\d{2}$/,
  week: /^\d{4}-\d{2}-\d{2}$/,
  month: /^\d{4}-\d{2}$/,
  year: /^\d{4}$/,
};

function blockEnd(from: Date, grouping: BlockGrouping): Date {
  switch (grouping) {
    case "day":
      return new Date(from.getTime() + DAY_MS);
    case "week":
      return new Date(from.getTime() + 7 * DAY_MS);
    case "month":
      return new Date(Date.UTC(from.getUTCFullYear(), from.getUTCMonth() + 1, 1));
    case "year":
      return new Date(Date.UTC(from.getUTCFullYear() + 1, 0, 1));
  }
}

/**
 * A key that is not its own first instant's key -- 31 February, a week that starts on a
 * Wednesday -- is refused: no block on screen produces it, so the form was written by hand.
 */
export function parseDateBlock(value: string): DateBlockSpan | null {
  const [name, key = ""] = value.split(":", 2);
  const grouping = dateGroupings.find((g): g is BlockGrouping => g !== "list" && g === name);
  if (!grouping || !BLOCK_KEY_SHAPE[grouping].test(key)) return null;
  const [year, month = 1, day = 1] = key.split("-").map(Number) as [number, number?, number?];
  const from = new Date(Date.UTC(year, month - 1, day));
  const block = dateBlockOf(from, grouping);
  if (block.key !== key) return null;
  return { value: dateBlockValue(grouping, key), grouping, key, label: block.label, from, to: blockEnd(from, grouping) };
}

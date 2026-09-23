export const dateGroupings = ["day", "week", "month", "year", "list"] as const;
export type DateGrouping = (typeof dateGroupings)[number];

export const DEFAULT_DATE_GROUPING: DateGrouping = "day";

export function parseDateGrouping(value: string | undefined): DateGrouping {
  return dateGroupings.find((g) => g === value) ?? DEFAULT_DATE_GROUPING;
}

export interface DateBlock<T> {
  key: string;
  label: string;
  items: T[];
  truncated: boolean;
}

export interface GroupByDateOptions<T> {
  grouping: Exclude<DateGrouping, "list">;
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

export function dateBlockOf(date: Date, grouping: Exclude<DateGrouping, "list">): { key: string; label: string } {
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

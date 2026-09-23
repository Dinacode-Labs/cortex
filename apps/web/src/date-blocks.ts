/**
 * The Memory list sorted by date, cut into blocks the way a photo gallery is.
 *
 * Every date is read in UTC: the page is rendered on the server, whose zone is whatever the host
 * happens to have, and a block boundary that moves with the deployment would be a bug nobody can
 * reproduce. Weeks start on Monday (ISO 8601).
 */

export const dateGroupings = ["day", "week", "month", "year", "list"] as const;
export type DateGrouping = (typeof dateGroupings)[number];

export const DEFAULT_DATE_GROUPING: DateGrouping = "day";

export function parseDateGrouping(value: string | undefined): DateGrouping {
  return dateGroupings.find((g) => g === value) ?? DEFAULT_DATE_GROUPING;
}

export interface DateBlock<T> {
  /** Stable per block: `2026-09-23`, the Monday of the week, `2026-09` or `2026`. */
  key: string;
  label: string;
  items: T[];
  /** The page limit cut this block: more of its items exist beyond what is shown. */
  truncated: boolean;
}

export interface GroupByDateOptions<T> {
  /** The span of one block. Required: `list` has no blocks. */
  grouping: Exclude<DateGrouping, "list">;
  /** The date the list is sorted by; mixing fields scatters a block across the page. Required. */
  dateOf: (item: T) => Date;
  /** How many items the page shows. Pass one item more than this so a cut block can be told
   *  apart from one that simply ends at the limit. Default: every item is shown. */
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

/**
 * Blocks come out in the order their first item appears, so they follow whatever direction the
 * list was sorted in without this function knowing it. Items already sorted by `dateOf` keep
 * every block contiguous.
 */
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

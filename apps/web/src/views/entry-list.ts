import { html } from "hono/html";
import type { ContextEntry, EntrySortField } from "@cortex/shared";
import { dateGroupings, groupByDate, type DateBlock, type DateGrouping } from "../date-blocks.js";
import { entryCard, joinHtml } from "./components.js";
import type { Html } from "./layout.js";

export const ENTRIES_PAGE = 60;
const MAX_ENTRIES_PAGE = 600;

export function parsePageLimit(value: string | undefined): number {
  const asked = Number.parseInt(value ?? "", 10);
  if (!Number.isFinite(asked)) return ENTRIES_PAGE;
  return Math.min(Math.max(asked, ENTRIES_PAGE), MAX_ENTRIES_PAGE);
}

const GROUPING_LABELS: Record<DateGrouping, string> = {
  day: "By day",
  week: "By week",
  month: "By month",
  year: "By year",
  list: "List",
};

export function groupingPills(active: DateGrouping, hrefFor: (grouping: DateGrouping) => string): Html {
  return html`<div class="filters">${joinHtml(
    dateGroupings.map(
      (g) => html`<a class="pill ${active === g ? "active" : ""}" href="${hrefFor(g)}">${GROUPING_LABELS[g]}</a>`,
    ),
    "",
  )}</div>`;
}

export interface EntryListOptions {
  pageLimit: number;
  dateField: EntrySortField;
  grouping?: DateGrouping;
  moreHref: (limit: number) => string;
}

export function entryList(fetched: ContextEntry[], opts: EntryListOptions): Html {
  const card = (e: ContextEntry) => entryCard(e, opts.dateField);
  const entries = fetched.slice(0, opts.pageLimit);
  const list =
    opts.grouping && opts.grouping !== "list"
      ? dateBlocks(
          groupByDate(fetched, {
            grouping: opts.grouping,
            dateOf: (e) => (opts.dateField === "updated" ? e.updatedAt : e.createdAt),
            limit: opts.pageLimit,
          }),
          card,
        )
      : html`<div class="grid">${entries.map(card)}</div>`;
  if (!opts.grouping || fetched.length <= opts.pageLimit) return list;
  const next = opts.pageLimit + ENTRIES_PAGE;
  return html`${list}${listMore(opts.pageLimit, next <= MAX_ENTRIES_PAGE ? opts.moreHref(next) : undefined)}`;
}

function dateBlocks(blocks: DateBlock<ContextEntry>[], card: (entry: ContextEntry) => Html): Html {
  return html`${blocks.map(
    (b) => html`<section class="date-block">
      <h2 class="date-block-head">${b.label} <span class="date-block-count">${blockCount(b)}</span></h2>
      <div class="grid">${b.items.map(card)}</div>
    </section>`,
  )}`;
}

function blockCount(block: DateBlock<unknown>): string {
  const n = block.items.length;
  if (block.truncated) return `${n} shown, more past the end of the page`;
  return `${n} ${n === 1 ? "entry" : "entries"}`;
}

function listMore(shown: number, moreHref?: string): Html {
  return html`<div class="list-more">
    <span>Showing the first ${shown}.</span>
    ${moreHref
      ? html`<a class="button secondary" href="${moreHref}">Show more</a>`
      : html`<span>Narrow by type or status to see the rest.</span>`}
  </div>`;
}

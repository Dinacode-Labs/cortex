import { html } from "hono/html";
import type { EntrySortField } from "@cortex/shared";
import { dateBlockValue, groupByDate, type BlockGrouping, type DateBlock, type DateGrouping } from "../date-blocks.js";
import { confidenceMeter, statusBadge, typeTag } from "./components.js";
import type { Html } from "./layout.js";
import type { Memo } from "@cortex/core";

export const ENTRIES_PAGE = 60;
const MAX_ENTRIES_PAGE = 600;

export function parsePageLimit(value: string | undefined): number {
  const asked = Number.parseInt(value ?? "", 10);
  if (!Number.isFinite(asked)) return ENTRIES_PAGE;
  return Math.min(Math.max(asked, ENTRIES_PAGE), MAX_ENTRIES_PAGE);
}

export const GROUPING_LABELS: Record<DateGrouping, string> = {
  day: "By day",
  week: "By week",
  month: "By month",
  year: "By year",
  list: "List",
};

export interface EntryPick {
  checked: boolean;
}

export interface EntryListOptions {
  pageLimit: number;
  dateField: EntrySortField;
  grouping?: DateGrouping;
  moreHref: (limit: number) => string;
  pick?: EntryPick;
}

interface RowOptions {
  dateField: EntrySortField;
  /** Inside a block of one day the date is already in its heading: only the hour is new. */
  hourOnly: boolean;
  pick?: EntryPick;
}

function entryRow(entry: Memo, opts: RowOptions): Html {
  const iso = (opts.dateField === "updated" ? entry.updatedAt : entry.createdAt).toISOString();
  const stamp = iso.slice(0, 16).replace("T", " ");
  const verb = opts.dateField === "updated" ? "Updated" : "Added";
  return html`<div class="entry-row">
    ${opts.pick
      ? html`<input class="row-pick" type="checkbox" name="ids" value="${entry.id}" aria-label="Select: ${entry.title}" ${opts.pick.checked ? "checked" : ""}>`
      : ""}
    <div class="entry-main">
      <div class="entry-meta">${typeTag(entry.type)}<span class="entry-source">${entry.sourceReference ?? entry.sourceType}</span></div>
      <a class="entry-title" href="/entry/${entry.id}">${entry.title}</a>
      <p class="entry-summary">${entry.summary ?? entry.content}</p>
    </div>
    <div class="entry-facts">
      ${statusBadge(entry.status)}
      ${confidenceMeter(entry.confidence)}
      <time class="entry-time" datetime="${iso}" title="${verb} ${stamp} UTC">${opts.hourOnly ? stamp.slice(11) : stamp.slice(0, 10)}</time>
    </div>
  </div>`;
}

export function entryList(fetched: Memo[], opts: EntryListOptions): Html {
  const rowOptions: RowOptions = { dateField: opts.dateField, hourOnly: opts.grouping === "day", pick: opts.pick };
  const row = (e: Memo) => entryRow(e, rowOptions);
  const list =
    opts.grouping && opts.grouping !== "list"
      ? dateBlocks(
          groupByDate(fetched, {
            grouping: opts.grouping,
            dateOf: (e) => (opts.dateField === "updated" ? e.updatedAt : e.createdAt),
            limit: opts.pageLimit,
          }),
          row,
          opts.pick ? opts.grouping : undefined,
        )
      : html`<div class="entry-rows">${fetched.slice(0, opts.pageLimit).map(row)}</div>`;
  const listed = html`<div class="entry-list">${list}</div>`;
  if (!opts.grouping || fetched.length <= opts.pageLimit) return listed;
  const next = opts.pageLimit + ENTRIES_PAGE;
  return html`${listed}${listMore(opts.pageLimit, next <= MAX_ENTRIES_PAGE ? opts.moreHref(next) : undefined)}`;
}

/** `pickable` gives each heading a box that takes the whole block, past the page included (ADR-0087). */
function dateBlocks(blocks: DateBlock<Memo>[], row: (entry: Memo) => Html, pickable?: BlockGrouping): Html {
  return html`${blocks.map(
    (b) => html`<section class="date-block">
      <h2 class="date-block-head">${pickable ? blockPick(b, pickable) : b.label} <span class="date-block-count">${blockCount(b)}</span></h2>
      ${b.items.map(row)}
    </section>`,
  )}`;
}

function blockPick(block: DateBlock<unknown>, grouping: BlockGrouping): Html {
  return html`<label class="block-pick"><input type="checkbox" name="blocks" value="${dateBlockValue(grouping, block.key)}" aria-label="Select all of ${block.label}" ${block.truncated ? "data-truncated" : ""}> ${block.label}</label>`;
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

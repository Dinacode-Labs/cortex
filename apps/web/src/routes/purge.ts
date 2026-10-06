import { Hono, type Context } from "hono";
import { html } from "hono/html";
import {
  findPurgeScope,
  getEntryDetail,
  NotAManagerError,
  purgeEntries,
  summarizePurgeScope,
  type ScopedMemo,
  type SessionUser,
} from "@cortex/core";
import { contextEntryStatus, contextEntryTypeInput, type EntrySortField } from "@cortex/shared";
import { parseDateBlock, type DateBlockSpan } from "../date-blocks.js";
import { layout } from "../views/layout.js";
import { empty, panel, warn } from "../views/components.js";
import { projectHeader } from "../views/project-nav.js";
import { requireProjectPage, type ProjectPage } from "../middleware/access.js";
import type { WebEnv } from "../middleware/session.js";

export const purgeRoutes = new Hono<WebEnv>();

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const TITLES_SHOWN = 60;

type PurgeForm = Record<string, string | File | (string | File)[]>;

function formValues(form: PurgeForm, key: string): string[] {
  const raw = form[key];
  const values = Array.isArray(raw) ? raw : raw === undefined ? [] : [raw];
  return values.filter((v): v is string => typeof v === "string");
}

function selectedIds(form: PurgeForm): string[] {
  return [...new Set(formValues(form, "ids").filter((v) => UUID.test(v)))];
}

function selectedBlocks(form: PurgeForm): DateBlockSpan[] {
  const blocks = new Map<string, DateBlockSpan>();
  for (const value of formValues(form, "blocks")) {
    const block = parseDateBlock(value);
    if (block) blocks.set(block.value, block);
  }
  return [...blocks.values()];
}

function instantOf(value: PurgeForm[string] | undefined): Date | null {
  if (typeof value !== "string") return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

const LIST_STATE_KEYS = ["type", "status", "sort", "dir", "group", "limit"] as const;

function listFilters(form: PurgeForm): Record<string, string> {
  return Object.fromEntries(
    LIST_STATE_KEYS.flatMap((key) => {
      const value = form[key];
      return typeof value === "string" && value ? [[key, value]] : [];
    }),
  );
}

function memoryUrl(slug: string, params: Record<string, string>): string {
  const qs = new URLSearchParams(params).toString();
  return qs ? `/p/${slug}?${qs}` : `/p/${slug}`;
}

interface Selection {
  ids: string[];
  blocks: DateBlockSpan[];
  wholeProject: boolean;
}

/** The blocks and "everything" are read with the list's own filters: what was on screen is what goes. */
async function memosInScope(
  slug: string,
  filters: Record<string, string>,
  selection: Selection,
  asOf: Date,
  user: SessionUser,
): Promise<ScopedMemo[]> {
  if (!selection.wholeProject && !selection.blocks.length) return [];
  const type = contextEntryTypeInput.safeParse(filters.type);
  const status = contextEntryStatus.safeParse(filters.status);
  const field = blockDateField(filters);
  return findPurgeScope(
    {
      project: slug,
      type: type.success ? type.data : undefined,
      status: status.success ? status.data : undefined,
      periods: selection.wholeProject ? undefined : selection.blocks.map((b) => ({ field, from: b.from, to: b.to })),
      writtenBefore: asOf,
    },
    user,
  );
}

function blockDateField(filters: Record<string, string>): EntrySortField {
  return filters.sort === "updated" ? "updated" : "created";
}

async function pickedOutsideScope(ids: string[], scoped: ScopedMemo[], projectId: string): Promise<ScopedMemo[]> {
  const inScope = new Set(scoped.map((m) => m.id));
  const details = await Promise.all(ids.filter((id) => !inScope.has(id)).map(getEntryDetail));
  return details.flatMap((d) =>
    d && d.entry.projectId === projectId
      ? [{ id: d.entry.id, title: d.entry.title, type: d.entry.type, createdAt: d.entry.createdAt, updatedAt: d.entry.updatedAt }]
      : [],
  );
}

const onlyManagers = (c: Context<WebEnv>, page: ProjectPage) =>
  c.html(
    layout(
      "Not allowed",
      html`${projectHeader(page, "memory")}
        ${empty("Only the owner of this project or an administrator can purge its entries.")}`,
      c.get("user"),
    ),
    403,
  );

purgeRoutes.post("/p/:slug/purge", async (c) => {
  const user = c.get("user")!;
  const slug = c.req.param("slug");
  const page = await requireProjectPage(c, slug);
  if (page instanceof Response) return page;
  if (!page.manager) return onlyManagers(c, page);

  const form = await c.req.parseBody({ all: true });
  const filters = listFilters(form);
  const selection: Selection = { ids: selectedIds(form), blocks: selectedBlocks(form), wholeProject: form.scope === "all" };
  if (!selection.ids.length && !selection.blocks.length && !selection.wholeProject) return c.redirect(memoryUrl(slug, filters));

  const confirming = form.confirm === "1";
  const asOf = (confirming && instantOf(form.asOf)) || new Date();
  try {
    const scoped = await memosInScope(slug, filters, selection, asOf, user);
    const slugTyped = typeof form.confirmSlug === "string" && form.confirmSlug.trim() === slug;
    if (confirming && (!selection.wholeProject || slugTyped)) {
      const { purged } = await purgeEntries([...selection.ids, ...scoped.map((m) => m.id)], user);
      return c.redirect(memoryUrl(slug, { ...filters, purged: String(purged.length) }));
    }

    const picked = await pickedOutsideScope(selection.ids, scoped, page.project.id);
    if (scoped.length + picked.length === 0) return c.redirect(memoryUrl(slug, filters));
    const body = confirmation(page, { slug, filters, selection, scoped, picked, asOf, wrongSlug: confirming });
    return c.html(layout(`${page.project.name} · Purge entries`, body, { user }), confirming ? 400 : 200);
  } catch (e) {
    if (e instanceof NotAManagerError) return onlyManagers(c, page);
    throw e;
  }
});

interface ConfirmationInput {
  slug: string;
  filters: Record<string, string>;
  selection: Selection;
  scoped: ScopedMemo[];
  picked: ScopedMemo[];
  asOf: Date;
  wrongSlug: boolean;
}

function everythingLabel(filters: Record<string, string>): string {
  const narrowed = [filters.type ? `of type ${filters.type}` : "", filters.status ? `with status ${filters.status}` : ""];
  return ["Every entry", ...narrowed.filter(Boolean), "saved to this project"].join(" ");
}

function inBlock(block: DateBlockSpan, field: EntrySortField) {
  return (m: ScopedMemo) => {
    const date = field === "updated" ? m.updatedAt : m.createdAt;
    return date >= block.from && date < block.to;
  };
}

function confirmation(page: ProjectPage, input: ConfirmationInput) {
  const { slug, filters, selection, scoped, picked } = input;
  const going = [...scoped, ...picked];
  const noun = going.length === 1 ? "entry" : "entries";
  const field = blockDateField(filters);
  const byType = Object.entries(summarizePurgeScope(going).byType)
    .sort(([, a], [, b]) => (b ?? 0) - (a ?? 0))
    .map(([type, n]) => `${type} ${n}`)
    .join(" · ");

  const reach = [
    ...(selection.wholeProject ? [html`<li>${everythingLabel(filters)}: <b>${scoped.length}</b></li>`] : []),
    ...(selection.wholeProject
      ? []
      : selection.blocks.map((b) => html`<li>${b.label}, whole: <b>${scoped.filter(inBlock(b, field)).length}</b></li>`)),
    ...(picked.length ? [html`<li>Picked one by one: <b>${picked.length}</b></li>`] : []),
  ];
  const hidden: [string, string][] = [
    ...picked.map((m): [string, string] => ["ids", m.id]),
    ...(selection.wholeProject ? [["scope", "all"] as [string, string]] : selection.blocks.map((b): [string, string] => ["blocks", b.value])),
    ...Object.entries(filters),
    ["asOf", input.asOf.toISOString()],
    ["confirm", "1"],
  ];

  return html`
    ${projectHeader(page, "memory")}
    ${panel(
      `Purge ${going.length} ${noun} for good?`,
      html`${warn(
          html`This cannot be undone. They are deleted, not marked: they will not come back in search, in what
            agents see, in the map or in Health. Only who purged them and when is kept, not what they said. If an
            entry is merely wrong, "No, it is wrong" on its page keeps the record.`,
          "contradiction",
        )}
        ${input.wrongSlug ? warn(html`That is not this project's slug, so nothing was purged.`) : ""}
        <ul class="purge-reach">${reach}</ul>
        <p class="sub">${byType}.${page.children.length ? " Its child projects keep their own entries." : ""}
          Anything written after this page was opened is left alone.</p>
        <ul class="findings">
          ${going.slice(0, TITLES_SHOWN).map((m) => html`<li><a href="/entry/${m.id}">${m.title}</a></li>`)}
          ${going.length > TITLES_SHOWN ? html`<li class="sub">…and ${going.length - TITLES_SHOWN} more.</li>` : ""}
        </ul>
        <form class="row" method="post" action="/p/${slug}/purge">
          ${hidden.map(([k, v]) => html`<input type="hidden" name="${k}" value="${v}">`)}
          ${selection.wholeProject
            ? html`<label class="confirm-slug">Type <code>${slug}</code> to confirm
                <input name="confirmSlug" autocomplete="off" spellcheck="false" required></label>`
            : ""}
          <button class="danger" type="submit">Purge ${going.length} ${noun} permanently</button>
          <a class="button quiet" href="${memoryUrl(slug, filters)}">Cancel</a>
        </form>`,
    )}`;
}

import { Hono, type Context } from "hono";
import { html } from "hono/html";
import { contextEntryStatus, contextEntryType } from "@cortex/shared";
import { getEntryDetail, NotAManagerError, purgeEntries } from "@cortex/core";
import { layout } from "../views/layout.js";
import { empty, panel, warn } from "../views/components.js";
import { projectHeader } from "../views/project-nav.js";
import { requireProjectPage, type ProjectPage } from "../middleware/access.js";
import type { WebEnv } from "../middleware/session.js";

/**
 * Deleting several entries of a project at once, from its Memory screen. It takes two posts on
 * purpose: the first only shows what is about to go, the second (`confirm=1`) deletes. That is
 * the confirmation, and it needs no JavaScript.
 */
export const purgeRoutes = new Hono<WebEnv>();

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

type PurgeForm = Record<string, string | File | (string | File)[]>;

function selectedIds(form: PurgeForm): string[] {
  const raw = form.ids;
  const values = Array.isArray(raw) ? raw : raw === undefined ? [] : [raw];
  return [...new Set(values.filter((v): v is string => typeof v === "string" && UUID.test(v)))];
}

/** Where the list was, so deleting from a filtered view does not throw the filter away. */
function listFilters(form: PurgeForm): Record<string, string> {
  const type = contextEntryType.safeParse(form.type);
  const status = contextEntryStatus.safeParse(form.status);
  return { ...(type.success ? { type: type.data } : {}), ...(status.success ? { status: status.data } : {}) };
}

function memoryUrl(slug: string, params: Record<string, string>): string {
  const qs = new URLSearchParams(params).toString();
  return qs ? `/p/${slug}?${qs}` : `/p/${slug}`;
}

const onlyManagers = (c: Context<WebEnv>, page: ProjectPage) =>
  c.html(
    layout(
      "Not allowed",
      html`${projectHeader(page, "memory")}
        ${empty("Only the owner of this project or an administrator can delete its entries.")}`,
      c.get("user"),
    ),
    403,
  );

purgeRoutes.post("/p/:slug/purge", async (c) => {
  const user = c.get("user")!;
  const slug = c.req.param("slug");
  const page = await requireProjectPage(c, slug);
  if (page instanceof Response) return page;
  const { project } = page;
  if (!page.manager) return onlyManagers(c, page);

  const form = await c.req.parseBody({ all: true });
  const filters = listFilters(form);
  const ids = selectedIds(form);
  if (ids.length === 0) return c.redirect(memoryUrl(slug, filters));

  if (form.confirm === "1") {
    try {
      const { purged } = await purgeEntries(ids, user.email);
      return c.redirect(memoryUrl(slug, { ...filters, purged: String(purged.length) }));
    } catch (e) {
      if (e instanceof NotAManagerError) return onlyManagers(c, page);
      throw e;
    }
  }

  // Only what is in THIS project is offered for deletion: the ids come from a form, and one that
  // names an entry from elsewhere must not turn a click here into a deletion there.
  const details = await Promise.all(ids.map(getEntryDetail));
  const entries = details.flatMap((d) => (d && d.entry.projectId === project.id ? [d.entry] : []));
  if (entries.length === 0) return c.redirect(memoryUrl(slug, filters));

  const noun = entries.length === 1 ? "entry" : "entries";
  const body = html`
    ${projectHeader(page, "memory")}
    ${panel(
      `Delete ${entries.length} ${noun} permanently?`,
      html`${warn(
          html`This cannot be undone. They are removed from the memory, not marked obsolete, and no agent will
            see them again. If an entry is only wrong, <b>No, it is wrong</b> on the entry keeps the record of it.`,
          "contradiction",
        )}
        <ul class="findings">${entries.map((e) => html`<li><a href="/entry/${e.id}">${e.title}</a></li>`)}</ul>
        <form class="row" method="post" action="/p/${slug}/purge">
          ${entries.map((e) => html`<input type="hidden" name="ids" value="${e.id}">`)}
          ${Object.entries(filters).map(([k, v]) => html`<input type="hidden" name="${k}" value="${v}">`)}
          <input type="hidden" name="confirm" value="1">
          <button class="danger" type="submit">Delete ${entries.length} ${noun}</button>
          <a class="button quiet" href="${memoryUrl(slug, filters)}">Cancel</a>
        </form>`,
    )}`;
  return c.html(layout(`${project.name} · Delete entries`, body, { user }));
});

import { Hono, type Context } from "hono";
import { html } from "hono/html";
import { getEntryDetail, NotAManagerError, purgeEntries } from "@cortex/core";
import { layout } from "../views/layout.js";
import { empty, panel, warn } from "../views/components.js";
import { projectHeader } from "../views/project-nav.js";
import { requireProjectPage, type ProjectPage } from "../middleware/access.js";
import type { WebEnv } from "../middleware/session.js";

export const purgeRoutes = new Hono<WebEnv>();

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

type PurgeForm = Record<string, string | File | (string | File)[]>;

function selectedIds(form: PurgeForm): string[] {
  const raw = form.ids;
  const values = Array.isArray(raw) ? raw : raw === undefined ? [] : [raw];
  return [...new Set(values.filter((v): v is string => typeof v === "string" && UUID.test(v)))];
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

  const details = await Promise.all(ids.map(getEntryDetail));
  const entries = details.flatMap((d) => (d && d.entry.projectId === project.id ? [d.entry] : []));
  if (entries.length === 0) return c.redirect(memoryUrl(slug, filters));

  const noun = entries.length === 1 ? "entry" : "entries";
  const body = html`
    ${projectHeader(page, "memory")}
    ${panel(
      `Purge ${entries.length} ${noun} for good?`,
      html`${warn(
          html`This cannot be undone. They are deleted, not marked: they will not come back in search, in what
            agents see, in the map or in Health. Only who purged them and when is kept, not what they said. If an
            entry is merely wrong, "No, it is wrong" on its page keeps the record.`,
          "contradiction",
        )}
        <ul class="findings">${entries.map((e) => html`<li><a href="/entry/${e.id}">${e.title}</a></li>`)}</ul>
        <form class="row" method="post" action="/p/${slug}/purge">
          ${entries.map((e) => html`<input type="hidden" name="ids" value="${e.id}">`)}
          ${Object.entries(filters).map(([k, v]) => html`<input type="hidden" name="${k}" value="${v}">`)}
          <input type="hidden" name="confirm" value="1">
          <button class="danger" type="submit">Purge ${entries.length} ${noun} permanently</button>
          <a class="button quiet" href="${memoryUrl(slug, filters)}">Cancel</a>
        </form>`,
    )}`;
  return c.html(layout(`${project.name} · Purge entries`, body, { user }));
});

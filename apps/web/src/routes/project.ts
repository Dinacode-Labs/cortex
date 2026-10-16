import { Hono } from "hono";
import { html } from "hono/html";
import {
  contextEntryStatus,
  contextEntryType,
  contextEntryTypeInput,
  entrySortField,
  getBrandName,
  sortDirection,
  type ContextEntryStatus,
  type ContextEntryType,
  type EntrySortField,
  type SortDirection,
} from "@cortex/shared";
import {
  checkEntryAccess,
  describeCriteria,
  entryFacets,
  getAcrossClient,
  getContextPack,
  lintProject,
  listAccessibleProjects,
  listEntries,
  renderContextPack,
  reviewsAwaiting,
  searchProjectCode,
  validateEntry,
  type EntrySort,
} from "@cortex/core";
import { askProjectContext } from "@cortex/agents";
import { layout, type Html } from "../views/layout.js";
import {
  badge,
  empty,
  entrySelection,
  joinHtml,
  menu,
  panel,
  projectTable,
  scoreBadge,
  searchForm,
  segmented,
  stateMark,
  statusBadge,
  statusLabel,
  typeBadge,
  typeTag,
  warn,
  type Tone,
} from "../views/components.js";
import { dateGroupings, parseDateGrouping } from "../date-blocks.js";
import { projectHealths } from "../project-summary.js";
import { ENTRIES_PAGE, GROUPING_LABELS, entryList, parsePageLimit } from "../views/entry-list.js";
import { mdLite } from "../views/md.js";
import { projectPage } from "../views/project-nav.js";
import { requireProjectPage } from "../middleware/access.js";
import type { WebEnv } from "../middleware/session.js";

/**
 * Everything looked at INSIDE a project, under `/p/<slug>/...` (ADR-0050).
 *
 * Each of these screens used to be a global route with its own project selector, and moving
 * from one to another sent you back to the first in the list. With the slug in the URL the
 * project cannot be lost, which was the real problem.
 */
export const projectRoutes = new Hono<WebEnv>();

/** Links an entry from the pack or the lint: seeing something wrong and being unable to touch
 *  it teaches people to ignore the warnings, which is exactly what we do not want (ADR-0050). */
const linkEntry = (id: string, text: Html | string): Html => html`<a href="/entry/${id}">${text}</a>`;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

projectRoutes.get("/p/:slug", async (c) => {
  const user = c.get("user")!;
  const res = await requireProjectPage(c, c.req.param("slug"));
  if (res instanceof Response) return res;
  const { project, children } = res;

  const typeParsed = contextEntryTypeInput.safeParse(c.req.query("type"));
  const type: ContextEntryType | undefined = typeParsed.success ? typeParsed.data : undefined;
  const statusParsed = contextEntryStatus.safeParse(c.req.query("status"));
  const status: ContextEntryStatus | undefined = statusParsed.success ? statusParsed.data : undefined;
  const sortParsed = entrySortField.safeParse(c.req.query("sort"));
  const sort: EntrySortField | undefined = sortParsed.success ? sortParsed.data : undefined;
  const dirParsed = sortDirection.safeParse(c.req.query("dir"));
  const dir: SortDirection | undefined = sort && dirParsed.success ? dirParsed.data : undefined;
  const effectiveSort: EntrySort = { by: sort ?? "created", dir: dir ?? "desc" };
  const grouping = sort ? parseDateGrouping(c.req.query("group")) : undefined;
  const pageLimit = sort ? parsePageLimit(c.req.query("limit")) : ENTRIES_PAGE;
  const showCapture = c.req.query("capture") === "1";
  const selectAll = c.req.query("select") === "all";
  const purged = Number(c.req.query("purged") ?? 0);

  const [entries, facets] = await Promise.all([
    listEntries({ project: project.name, type, status, sort: effectiveSort, limit: pageLimit + 1 }),
    entryFacets(project.name),
  ]);
  const countOf = (only: { type?: string; status?: string }) =>
    facets
      .filter((f) => (!only.type || f.type === only.type) && (!only.status || f.status === only.status))
      .reduce((n, f) => n + f.count, 0);
  const [healthOf, waitingInChildren] = await Promise.all([projectHealths(children), reviewsAwaiting(user, children)]);
  const base = `/p/${project.slug}`;
  const listState: Record<string, string> = {
    ...(type ? { type } : {}),
    ...(status ? { status } : {}),
    ...(sort ? { sort } : {}),
    ...(dir ? { dir } : {}),
    ...(grouping ? { group: grouping } : {}),
  };
  const pageState: Record<string, string> = pageLimit !== ENTRIES_PAGE ? { limit: String(pageLimit) } : {};
  const listOptions = {
    pageLimit,
    dateField: effectiveSort.by,
    grouping,
    moreHref: (limit: number) => withFilters({ limit: String(limit) }),
  };
  const withFilters = (extra: Record<string, string>) => {
    const qs = new URLSearchParams({ ...listState, ...extra });
    for (const [k, v] of [...qs]) if (!v) qs.delete(k);
    return qs.toString() ? `${base}?${qs}` : base;
  };

  // Filtering by status is what turns "348 unreviewed" into a list you can start from.
  const capitalised = (text: string) => text.charAt(0).toUpperCase() + text.slice(1);
  const statusFilter = segmented("Status", [
    { label: "All", href: withFilters({ status: "" }), on: !status, count: countOf({ type }) },
    ...contextEntryStatus.options.map((x) => ({
      label: capitalised(statusLabel(x)),
      href: withFilters({ status: x }),
      on: status === x,
      count: countOf({ type, status: x }),
    })),
  ]);

  const typeMenu = menu("Type", type ?? "all", [
    { label: "All types", href: withFilters({ type: "" }), on: !type, count: countOf({ status }) },
    ...contextEntryType.options.map((x) => ({
      label: typeTag(x),
      href: withFilters({ type: x }),
      on: type === x,
      count: countOf({ type: x, status }),
    })),
  ]);

  const sortOptions: (EntrySort & { label: string })[] = [
    { by: "created", dir: "desc", label: "Newest added" },
    { by: "created", dir: "asc", label: "Oldest added" },
    { by: "updated", dir: "desc", label: "Recently updated" },
    { by: "updated", dir: "asc", label: "Least recently updated" },
  ];
  const isCurrentSort = (o: EntrySort) => effectiveSort.by === o.by && effectiveSort.dir === o.dir;
  const sortMenu = menu(
    "Sort",
    sortOptions.find(isCurrentSort)?.label ?? "",
    sortOptions.map((o) => ({ label: o.label, href: withFilters({ sort: o.by, dir: o.dir }), on: isCurrentSort(o) })),
  );

  const groupMenu = grouping
    ? menu(
        "Group",
        GROUPING_LABELS[grouping],
        dateGroupings.map((g) => ({ label: GROUPING_LABELS[g], href: withFilters({ group: g }), on: grouping === g })),
      )
    : html``;

  const captureForm = showCapture
    ? panel(
        "Add to memory",
        html`<form method="post" action="/save">
          <input type="hidden" name="project" value="${project.name}">
          <textarea name="content" placeholder="What should ${getBrandName()} remember? A decision, a constraint, an incident…" required autofocus></textarea>
          <div class="row" style="margin-top:12px">
            <select name="type">
              <option value="">Classify automatically</option>
              ${contextEntryType.options.map((t) => html`<option value="${t}" ${t === type ? "selected" : ""}>${t}</option>`)}
            </select>
            <button type="submit">Save</button>
            <a class="button quiet" href="${base}">Cancel</a>
          </div>
        </form>`,
        { help: "Normally your agents write here. This is for what you know and they do not." },
      )
    : html``;

  // A client is above all the door to its repos: if opening it only shows its cross-cutting
  // entries, the hierarchy exists in the database and nowhere else.
  const childrenSection = children.length
    ? panel(
        "Projects in this client",
        projectTable(children.map((child) => ({ project: child, depth: 0, children: 0 })), healthOf, waitingInChildren),
        { help: "Everything remembered here is also part of what their agents are told." },
      )
    : html``;

  const body = projectPage(res, "memory", html`
    ${childrenSection}
    <div class="section-bar">
      ${searchForm(
        "/search",
        "",
        "Search this project by meaning…",
        { project: project.name },
        // Reaching down into the children is DELIBERATE and only exists here: inheritance goes
        // up, so from a repo you never see a sibling's knowledge, but from the client you can
        // ask them all at once. It is a checkbox, not a default, because it changes what you
        // are looking at (ADR-0063).
        children.length
          ? html`<label class="check"><input type="checkbox" name="children" value="1"> Include child projects</label>`
          : undefined,
      )}
      <a class="button secondary" href="${base}?capture=1">+ Add</a>
    </div>
    ${captureForm}
    <div class="list-controls">
      ${statusFilter}
      <div class="menus">${typeMenu}${sortMenu}${groupMenu}</div>
    </div>
    ${purged > 0 ? warn(`${purged} ${purged === 1 ? "entry" : "entries"} purged.`) : ""}
    ${entries.length
      ? res.manager
        ? entrySelection(entryList(entries, { ...listOptions, pick: { checked: selectAll } }), {
            action: `${base}/purge`,
            hidden: { ...listState, ...pageState },
            allChecked: selectAll,
            toggleHref: withFilters({ ...pageState, ...(selectAll ? {} : { select: "all" }) }),
            filtered: !!(type || status),
          })
        : entryList(entries, listOptions)
      : empty(
          type ? html`Nothing of type <b>${type}</b> here yet.` : "Nothing here yet.",
          type ? html`<a class="button secondary" href="${withFilters({ type: "" })}">Show all types</a>` : html`<a class="button" href="${base}?capture=1">Add the first entry</a>`,
        )}`);
  return c.html(layout(project.name, body, { user }));
});

projectRoutes.get("/p/:slug/ask", async (c) => {
  const user = c.get("user")!;
  const res = await requireProjectPage(c, c.req.param("slug"));
  if (res instanceof Response) return res;
  const { project } = res;
  const q = c.req.query("q") ?? "";

  let answerHtml: Html = html``;
  if (q) {
    const { answer, hits } = await askProjectContext(q, project.name, undefined, {
      restrictToAccessibleOf: user,
    });
    const sources = hits.length
      ? panel(
          "Sources used",
          html`<ul class="findings">${hits.map(
            (h) => html`<li>${scoreBadge(h.score)} ${linkEntry(h.entry.id, h.entry.title)}</li>`,
          )}</ul>`,
        )
      : empty("Nothing relevant was found for this question.");
    answerHtml = answer
      ? html`<div class="answer">${mdLite(answer)}</div>${sources}`
      : html`<div class="warn">⚠️ No language model is configured, so this is search only.</div>${sources}`;
  }

  const body = projectPage(res, "ask", html`
    ${panel(
      null,
      html`<form class="row" method="get" action="/p/${project.slug}/ask">
        <input type="text" name="q" placeholder="e.g. what should I watch out for in the billing module?" value="${q}" required autofocus>
        <button type="submit">Ask</button>
      </form>`,
      { help: "The retrieval agent answers from what is saved, and cites what it used." },
    )}
    ${q ? html`<h2 style="font-size:17px">${q}</h2>${answerHtml}` : ""}`);
  return c.html(layout(`${project.name} · Ask`, body, { user }));
});

projectRoutes.get("/p/:slug/agents", async (c) => {
  const user = c.get("user")!;
  const res = await requireProjectPage(c, c.req.param("slug"));
  if (res instanceof Response) return res;
  const { project, ancestors } = res;

  const area = c.req.query("area") || undefined;
  const asOfStr = c.req.query("asof");
  const asOf = asOfStr ? new Date(asOfStr) : undefined;
  const pack = await getContextPack(project.name, area, asOf);
  const criteria = describeCriteria(pack.criteria);

  // Where each entry comes from. A child's pack mixes its own knowledge with the client's, and
  // until now it did so silently: whoever reviewed "Acme Portal" saw decisions that are not in
  // Acme Portal, could not tell which, and correcting them meant touching the whole client's
  // memory without having decided to. Inheritance is marked where it shows.
  const byId = new Map(ancestors.map((a) => [a.id, a]));
  const origin = (e: { projectId: string | null }): Html => {
    const de = e.projectId && e.projectId !== project.id ? byId.get(e.projectId) : undefined;
    if (!de) return html``;
    return de.slug
      ? html`<a class="from-project" href="/p/${de.slug}">from ${de.name}</a>`
      : html`<span class="from-project">from ${de.name}</span>`;
  };

  const sec = (s: (typeof pack.sections)[number]): Html =>
    s.entries.length
      ? panel(
          s.title,
          html`${s.entries.map(
            (e) => html`<div class="pack-entry">
              <div class="card-head">${typeBadge(e.type)} ${statusBadge(e.status)} ${origin(e)}</div>
              <b>${linkEntry(e.id, e.title)}</b>
              <p class="sub">${e.summary ?? e.content}</p>
            </div>`,
          )}`,
          { actions: html`<span class="sub">${s.entries.length}</span>` },
        )
      : html``;

  const body = projectPage(res, "agents", html`
    <p class="sub">
      This is exactly what an agent is told when it opens a session on this project —
      ${pack.totalEntries} ${pack.totalEntries === 1 ? "entry" : "entries"} in total,
      ${asOf ? html`as they stood on <b>${asOfStr ?? ""}</b>` : "as they stand now"}.
    </p>
    ${ancestors.length
      ? html`<p class="sub">
          Anything marked <span class="from-project">from ${ancestors[ancestors.length - 1]!.name}</span> is inherited:
          it is recorded on the client project and every project under it is told about it.
        </p>`
      : ""}
    <div class="section-bar">
      <form class="row" method="get" action="/p/${project.slug}/agents">
        <input type="text" name="area" placeholder="Narrow to an area or module, e.g. billing" value="${area ?? ""}">
        <input type="date" name="asof" value="${asOfStr ?? ""}" title="What was in force on this date">
        <button type="submit">Update</button>
      </form>
      <a class="button secondary" href="/p/${project.slug}/agents.md${area ? `?area=${encodeURIComponent(area)}` : ""}">Copy as Markdown</a>
    </div>
    ${asOf ? html`<div class="warn">⏳ Point-in-time view: what was in force on ${asOfStr ?? ""}, including what was invalidated later.</div>` : ""}
    ${criteria
      ? html`<p class="note">
          <b>What this project keeps:</b> ${criteria}. <a href="/p/${project.slug}/settings">Change it</a>
        </p>`
      : ""}
    ${pack.sections.map(sec)}
    ${pack.sensitiveModules.length
      ? panel("Sensitive modules", html`<div class="row">${joinHtml(pack.sensitiveModules.map((m) => badge(m, "warn")), " ")}</div>`)
      : ""}
    ${pack.relevantToArea.length
      ? panel(
          `Most relevant to "${area ?? ""}"`,
          html`<ul class="findings">${pack.relevantToArea.map(
            (h) => html`<li>${scoreBadge(h.score)} ${linkEntry(h.entry.id, h.entry.title)}</li>`,
          )}</ul>`,
        )
      : ""}`);
  return c.html(layout(`${project.name} · What agents see`, body, { user }));
});

projectRoutes.get("/p/:slug/agents.md", async (c) => {
  const res = await requireProjectPage(c, c.req.param("slug"));
  if (res instanceof Response) return res;
  const pack = await getContextPack(res.project.name, c.req.query("area") || undefined);
  return c.text(renderContextPack(pack), 200, { "content-type": "text/plain; charset=utf-8" });
});

projectRoutes.get("/p/:slug/health", async (c) => {
  const user = c.get("user")!;
  const res = await requireProjectPage(c, c.req.param("slug"));
  if (res instanceof Response) return res;
  const { project, reviewer } = res;
  const r = await lintProject(project.name);
  const base = `/p/${project.slug}`;

  const searchLink = (text: string) =>
    `/search?q=${encodeURIComponent(text)}&project=${encodeURIComponent(project.name)}`;

  const tile = (id: string, label: string, value: Html | string, found: number, tone: Tone, state: string) =>
    html`<a class="tile" href="#${id}">
      <span class="tile-label">${label}</span>
      <span class="tile-value">${value}</span>
      ${found ? stateMark(tone, state) : stateMark("ok", "Clean")}
    </a>`;

  const settleForm = (keep: string, retire: string) =>
    html`<form method="post" action="${base}/health/settle">
      <input type="hidden" name="keep" value="${keep}">
      <input type="hidden" name="retire" value="${retire}">
      <button class="secondary" type="submit">Keep this one, retire the other</button>
    </form>`;
  const side = (title: string, id: string | null, otherId: string | null) =>
    html`<div class="pair-side">
      ${id ? html`<a class="pair-title" href="/entry/${id}">${title}</a>` : html`<span class="pair-title">${title}</span>`}
      ${reviewer && id && otherId ? settleForm(id, otherId) : ""}
    </div>`;
  const pair = (p: { a: string; b: string; aId: string | null; bId: string | null }, score?: number) =>
    html`<div class="finding-pair">
      ${side(p.a, p.aId, p.bId)}
      <span class="pair-link ${score === undefined ? "" : "same"}" role="img" aria-label="${score === undefined ? "contradicts" : `the same as, ${score.toFixed(2)}`}">${score === undefined ? "⟷" : html`≈<small>${score.toFixed(2)}</small>`}</span>
      ${side(p.b, p.bId, p.aId)}
    </div>`;
  const block = (id: string, title: string, help: string, tone: Tone, items: Html[]) =>
    panel(title, items.length ? html`<div class="findings-list">${items}</div>` : html`<p>${stateMark("ok", "Nothing to report.")}</p>`, {
      id,
      help,
      actions: badge(String(items.length), items.length ? tone : "neutral"),
    });

  const reviewedShare = r.totalEntries ? Math.round(((r.totalEntries - r.neverReviewed) / r.totalEntries) * 100) : 100;

  const body = projectPage(res, "health", html`
    <p class="sub lead">
      Whether this memory can still be trusted. Every finding opens what it is about${reviewer ? ", and a clash between two memos can be settled from here" : ""}.
    </p>
    ${c.req.query("settled") === "1"
      ? html`<p class="flash" role="status">Kept one and retired the other: it no longer counts as current, and its page keeps the record.</p>`
      : ""}
    <div class="tiles">
      ${tile("contradictions", "Contradictions", String(r.contradictions.length), r.contradictions.length, "danger", "Resolve first")}
      ${tile("gaps", "Incidents with no decision", String(r.gaps.length), r.gaps.length, "warn", "Worth a look")}
      ${tile("duplicates", "Possible duplicates", String(r.duplicates.length), r.duplicates.length, "warn", "Worth a look")}
      ${tile("orphans", "Orphan entities", String(r.orphanEntities.length), r.orphanEntities.length, "neutral", "Usually harmless")}
      ${tile("unreviewed", "Never reviewed by a person", html`${r.neverReviewed} <small>of ${r.totalEntries}</small>`, r.neverReviewed, "warn", "Worth a look")}
    </div>
    ${block(
      "contradictions",
      "Contradictions",
      "Two things recorded as current that cannot both be true. An agent will believe whichever it reads first.",
      "danger",
      r.contradictions.map((x) => pair(x)),
    )}
    ${block(
      "gaps",
      "Incidents with no decision",
      "Something went wrong repeatedly and nothing was decided about it. These are the gaps that bite twice.",
      "warn",
      r.gaps.map(
        (g) => html`<div class="finding-row">
          <div class="what"><a href="${searchLink(g.area)}"><b>${g.area}</b></a>
            <span class="sub">${g.type} · ${g.incidents} ${g.incidents === 1 ? "incident" : "incidents"}, no decisions</span></div>
          ${reviewer ? html`<a class="button secondary" href="${base}?capture=1&type=decision">Record a decision</a>` : ""}
        </div>`,
      ),
    )}
    ${block(
      "duplicates",
      "Possible duplicates",
      "The same thing recorded twice. Harmless until they drift apart and become a contradiction.",
      "warn",
      r.duplicates.map((d) => pair(d, d.score)),
    )}
    ${block(
      "orphans",
      "Orphan entities",
      "Names mentioned once and never connected to anything. Usually a typo or a one-off.",
      "neutral",
      r.orphanEntities.map(
        (e) => html`<div class="finding-row">
          <div class="what"><code>${e.name}</code> <span class="sub">${e.type} · mentioned once</span></div>
          <a class="button quiet" href="${searchLink(e.name)}">Where it is mentioned</a>
        </div>`,
      ),
    )}
    ${panel(
      "Nobody has reviewed these",
      r.neverReviewed
        ? html`<div class="finding-row">
            <div class="what">
              <div class="meter" role="img" aria-label="${reviewedShare}% reviewed"><span style="width:${reviewedShare}%"></span></div>
              <p class="sub"><b>${r.totalEntries - r.neverReviewed} of ${r.totalEntries}</b> current entries have been through a person.</p>
            </div>
            <a class="button secondary" href="${base}?status=pending_validation">Start reviewing</a>
          </div>`
        : html`<p class="sub">Everything current has been through a person. That is what makes the rest worth trusting.</p>`,
      {
        id: "unreviewed",
        help: "Agents wrote them. Until somebody says whether they hold, confidence and status carry no information and what agents see cannot favour what is trustworthy.",
        actions: badge(String(r.neverReviewed), r.neverReviewed ? "warn" : "ok"),
      },
    )}
    <p class="sub">
      Low confidence: <b>${r.lowConfidence}</b> · superseded or obsolete: <b>${r.staleHistorical}</b> ·
      total entries: <b>${r.totalEntries}</b>
    </p>`);
  return c.html(layout(`${project.name} · Health`, body, { user }));
});

/** Keep one, retire the other: the lint's own advice (`planLintActions`), as two web verdicts (ADR-0090). */
projectRoutes.post("/p/:slug/health/settle", async (c) => {
  const user = c.get("user")!;
  const res = await requireProjectPage(c, c.req.param("slug"));
  if (res instanceof Response) return res;
  const back = `/p/${res.project.slug}/health`;
  if (!res.reviewer) {
    const refusal = empty("Only the owner of this project, its members or an administrator settle its findings.");
    return c.html(layout("Not allowed", projectPage(res, "health", refusal), user), 403);
  }
  const form = await c.req.parseBody();
  const keep = String(form.keep ?? "");
  const retire = String(form.retire ?? "");
  if (!UUID.test(keep) || !UUID.test(retire) || keep === retire) return c.redirect(back);
  for (const id of [keep, retire]) {
    const access = await checkEntryAccess(user, id);
    if (access.status !== "ok" || access.project?.id !== res.project.id) return c.redirect(back);
  }
  await validateEntry(keep, "validated", { email: user.email, channel: "web" });
  await validateEntry(retire, "obsolete", { email: user.email, channel: "web" });
  return c.redirect(`${back}?settled=1`);
});

/**
 * The question that can only be asked from a parent: what its repos share and where they
 * contradict each other (ADR-0063). It only exists when there are children to look at.
 */
projectRoutes.get("/p/:slug/across", async (c) => {
  const user = c.get("user")!;
  const res = await requireProjectPage(c, c.req.param("slug"));
  if (res instanceof Response) return res;
  const { project, children } = res;
  // With no accessible children there is nothing to cross, and the tab is not painted either:
  // whoever arrives by URL gets the same as someone asking for a section that does not exist.
  if (children.length === 0) return c.notFound();

  const { sharedStack, contradictions } = await getAcrossClient(project, user);
  const projectLink = (p: { name: string; slug: string | null }): Html =>
    p.slug ? html`<a href="/p/${p.slug}">${p.name}</a>` : html`${p.name}`;

  const stack = sharedStack.length
    ? html`<ul class="findings">${sharedStack.map(
        (e) => html`<li>
          <b>${e.name}</b> ${typeBadge(e.type)}
          <span class="sub">in ${e.projects.length} of ${children.length}:</span>
          ${joinHtml(e.projects.map(projectLink), ", ")}
        </li>`,
      )}</ul>`
    : empty(
        html`Nothing is linked from two of these projects yet. Either they share less than it seems, or their
          memory is still thin.`,
      );

  const choques = contradictions.length
    ? html`<ul class="findings">${contradictions.map(
        (x) => html`<li>
          ${linkEntry(x.a.id, x.a.title)} <span class="from-project">${x.a.project.name}</span>
          <b>⟷</b>
          ${linkEntry(x.b.id, x.b.title)} <span class="from-project">${x.b.project.name}</span>
        </li>`,
      )}</ul>`
    : html`<p class="sub">Nothing to report. Health checks each project on its own; this is the part nobody else looks at.</p>`;

  const body = projectPage(res, "across", html`
    <p class="sub">
      What these ${children.length} projects have in common, and where they disagree. Each project only ever reads
      what this client knows, never what a sibling knows — so this is the one place a conflict between two of
      them can show up.
    </p>
    ${panel("Shared across these projects", stack, {
      help:
        "Technologies, modules, services, integrations and vendors that appear in the memory of two or more of them. It is what has been written down, not an inventory of the architecture.",
      actions: badge(String(sharedStack.length), sharedStack.length ? "accent" : "neutral"),
    })}
    ${panel("Contradictions between projects", choques, {
      help:
        "Two things recorded as current in different projects that cannot both be true. An agent in either one will only ever see its own side.",
      actions: badge(String(contradictions.length), contradictions.length ? "danger" : "neutral"),
    })}`);
  return c.html(layout(`${project.name} · Across this client`, body, { user }));
});

projectRoutes.get("/p/:slug/map", async (c) => {
  const user = c.get("user")!;
  const res = await requireProjectPage(c, c.req.param("slug"));
  if (res instanceof Response) return res;
  const { project } = res;
  // The checkbox sends "1" or nothing; reading it as `!== "0"` made it IMPOSSIBLE to untick
  // from the UI. A hidden field with the default value before the checkbox fixes it without JS,
  // but then both arrive (`?entries=0&entries=1`) and `query()` returns the FIRST one: it has
  // to keep the last, or the box can never be ticked again.
  const includeEntries = (c.req.queries("entries")?.at(-1) ?? "1") !== "0";

  const body = projectPage(res, "map", html`
    <p class="sub">How this project's knowledge connects, and where it does not.</p>
    ${panel(
      null,
      html`<form class="row" method="get" action="/p/${project.slug}/map">
        <input type="hidden" name="entries" value="0">
        <label class="check"><input type="checkbox" name="entries" value="1" ${includeEntries ? "checked" : ""}> Include entries</label>
        <button type="submit">Update</button>
      </form>`,
    )}
    <div id="legend"></div>
    <div id="net" data-project="${project.name}" data-entries="${includeEntries ? "1" : "0"}"></div>
    <script src="https://unpkg.com/vis-network@9.1.9/standalone/umd/vis-network.min.js"></script>
    <script src="/graph.js"></script>`);
  return c.html(layout(`${project.name} · Map`, body, { user }));
});

projectRoutes.get("/p/:slug/code", async (c) => {
  const user = c.get("user")!;
  const res = await requireProjectPage(c, c.req.param("slug"));
  if (res instanceof Response) return res;
  const { project } = res;
  const q = c.req.query("q") ?? "";

  let results: Html = html``;
  if (q) {
    const hits = await searchProjectCode(q, project.name, 10);
    results = hits.length
      ? html`${hits.map((h) => {
          const body = h.content.startsWith("// ") ? h.content.slice(h.content.indexOf("\n") + 1) : h.content;
          return html`<section class="panel">
            <div class="card-head">${scoreBadge(h.score)} <b>${h.path}</b>
              <span class="sub">:${h.startLine}-${h.endLine} · ${h.language ?? ""}</span></div>
            <pre class="content-block" style="overflow:auto"><code>${body}</code></pre>
          </section>`;
        })}`
      : empty(html`No results. Has this repository been indexed? An operator runs <code>cortex-admin index-code</code>.`);
  }

  const body = projectPage(res, "code", html`
    ${panel(null, searchForm(`/p/${project.slug}/code`, q, "e.g. where is the user's phone number verified"), {
      help: "Hybrid search, semantic and lexical, over this project's indexed code.",
    })}
    ${q ? html`<h2 style="font-size:16px">"${q}"</h2>${results}` : ""}`);
  return c.html(layout(`${project.name} · Code`, body, { user }));
});

import { Hono } from "hono";
import { html } from "hono/html";
import {
  contextEntryStatus,
  contextEntryType,
  getBrandName,
  type ContextEntryStatus,
  type ContextEntryType,
} from "@cortex/shared";
import {
  getAcrossClient,
  getContextPack,
  lintProject,
  listAccessibleProjects,
  listEntries,
  renderContextPack,
  searchProjectCode,
} from "@cortex/core";
import { askProjectContext } from "@cortex/agents";
import { layout, type Html } from "../views/layout.js";
import { badge, empty, entryCard, joinHtml, panel, projectCard, scoreBadge, searchForm, statusBadge, typeBadge } from "../views/components.js";
import { projectHealth } from "../project-summary.js";
import { mdLite } from "../views/md.js";
import { projectHeader } from "../views/project-nav.js";
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

// --- Memory ------------------------------------------------------------------------------

projectRoutes.get("/p/:slug", async (c) => {
  const user = c.get("user")!;
  const res = await requireProjectPage(c, c.req.param("slug"));
  if (res instanceof Response) return res;
  const { project, children } = res;

  const typeParsed = contextEntryType.safeParse(c.req.query("type"));
  const type: ContextEntryType | undefined = typeParsed.success ? typeParsed.data : undefined;
  const statusParsed = contextEntryStatus.safeParse(c.req.query("status"));
  const status: ContextEntryStatus | undefined = statusParsed.success ? statusParsed.data : undefined;
  const showCapture = c.req.query("capture") === "1";

  const entries = await listEntries({ project: project.name, type, status, limit: 60 });
  const healths = await Promise.all(children.map((h) => projectHealth(h.name)));
  const base = `/p/${project.slug}`;
  const withFilters = (extra: Record<string, string>) => {
    const qs = new URLSearchParams({ ...(type ? { type } : {}), ...(status ? { status } : {}), ...extra });
    for (const [k, v] of [...qs]) if (!v) qs.delete(k);
    return qs.toString() ? `${base}?${qs}` : base;
  };

  const typePills = [
    html`<a class="pill ${!type ? "active" : ""}" href="${withFilters({ type: "" })}">All types</a>`,
    ...contextEntryType.options.map(
      (x) => html`<a class="pill ${type === x ? "active" : ""}" href="${withFilters({ type: x })}">${x}</a>`,
    ),
  ];

  // Filtering by status is what turns "348 unreviewed" into a list you can start from.
  const statusPills = [
    html`<a class="pill ${!status ? "active" : ""}" href="${withFilters({ status: "" })}">Any status</a>`,
    ...contextEntryStatus.options.map(
      (x) => html`<a class="pill ${status === x ? "active" : ""}" href="${withFilters({ status: x })}">${x}</a>`,
    ),
  ];

  const captureForm = showCapture
    ? panel(
        "Add to memory",
        html`<form method="post" action="/save">
          <input type="hidden" name="project" value="${project.name}">
          <textarea name="content" placeholder="What should ${getBrandName()} remember? A decision, a constraint, an incident…" required autofocus></textarea>
          <div class="row" style="margin-top:12px">
            <select name="type">
              <option value="">Classify automatically</option>
              ${contextEntryType.options.map((t) => html`<option value="${t}">${t}</option>`)}
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
        html`<div class="project-grid">${children.map((h, i) => projectCard(h, healths[i]!))}</div>`,
        { help: "Everything remembered here is also part of what their agents are told." },
      )
    : html``;

  const body = html`
    ${projectHeader(res, "memory")}
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
    <div class="filters">${joinHtml(typePills, "")}</div>
    <div class="filters">${joinHtml(statusPills, "")}</div>
    ${entries.length
      ? html`<div class="grid">${entries.map(entryCard)}</div>`
      : empty(
          type ? html`Nothing of type <b>${type}</b> here yet.` : "Nothing here yet.",
          type ? html`<a class="button secondary" href="${base}">Show all types</a>` : html`<a class="button" href="${base}?capture=1">Add the first entry</a>`,
        )}`;
  return c.html(layout(project.name, body, { user }));
});

// --- Ask ---------------------------------------------------------------------------------

projectRoutes.get("/p/:slug/ask", async (c) => {
  const user = c.get("user")!;
  const res = await requireProjectPage(c, c.req.param("slug"));
  if (res instanceof Response) return res;
  const { project } = res;
  const q = c.req.query("q") ?? "";

  let answerHtml: Html = html``;
  if (q) {
    const { answer, hits } = await askProjectContext(q, project.name, undefined, {
      restrictToAccessibleOf: user.email,
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

  const body = html`
    ${projectHeader(res, "ask")}
    ${panel(
      null,
      html`<form class="row" method="get" action="/p/${project.slug}/ask">
        <input type="text" name="q" placeholder="e.g. what should I watch out for in the billing module?" value="${q}" required autofocus>
        <button type="submit">Ask</button>
      </form>`,
      { help: "The retrieval agent answers from what is saved, and cites what it used." },
    )}
    ${q ? html`<h2 style="font-size:17px">${q}</h2>${answerHtml}` : ""}`;
  return c.html(layout(`${project.name} · Ask`, body, { user }));
});

// --- What agents see (context pack) -------------------------------------------------------

projectRoutes.get("/p/:slug/agents", async (c) => {
  const user = c.get("user")!;
  const res = await requireProjectPage(c, c.req.param("slug"));
  if (res instanceof Response) return res;
  const { project, ancestors } = res;

  const area = c.req.query("area") || undefined;
  const asOfStr = c.req.query("asof");
  const asOf = asOfStr ? new Date(asOfStr) : undefined;
  const pack = await getContextPack(project.name, area, asOf);

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

  const body = html`
    ${projectHeader(res, "agents")}
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
    ${pack.sections.map(sec)}
    ${pack.sensitiveModules.length
      ? panel("Sensitive modules", html`<div class="row">${joinHtml(pack.sensitiveModules.map((m) => badge(m, "#8a4b00")), " ")}</div>`)
      : ""}
    ${pack.relevantToArea.length
      ? panel(
          `Most relevant to "${area ?? ""}"`,
          html`<ul class="findings">${pack.relevantToArea.map(
            (h) => html`<li>${scoreBadge(h.score)} ${linkEntry(h.entry.id, h.entry.title)}</li>`,
          )}</ul>`,
        )
      : ""}`;
  return c.html(layout(`${project.name} · What agents see`, body, { user }));
});

/** The same pack in markdown, which is how the agent receives it: to paste wherever needed. */
projectRoutes.get("/p/:slug/agents.md", async (c) => {
  const res = await requireProjectPage(c, c.req.param("slug"));
  if (res instanceof Response) return res;
  const pack = await getContextPack(res.project.name, c.req.query("area") || undefined);
  return c.text(renderContextPack(pack), 200, { "content-type": "text/plain; charset=utf-8" });
});

// --- Health (lint) ------------------------------------------------------------------------

projectRoutes.get("/p/:slug/health", async (c) => {
  const user = c.get("user")!;
  const res = await requireProjectPage(c, c.req.param("slug"));
  if (res instanceof Response) return res;
  const { project } = res;
  const r = await lintProject(project.name);

  const searchLink = (text: string) =>
    `/search?q=${encodeURIComponent(text)}&project=${encodeURIComponent(project.name)}`;

  const card = (title: string, help: string, color: string, items: Html[]) =>
    panel(
      title,
      items.length
        ? html`<ul class="findings">${items.map((i) => html`<li>${i}</li>`)}</ul>`
        : html`<p class="sub">Nothing to report.</p>`,
      { help, actions: badge(String(items.length), items.length ? color : "#5b6673") },
    );

  const body = html`
    ${projectHeader(res, "health")}
    <p class="sub">Whether this memory can still be trusted. Every finding links to what it is about.</p>
    ${card(
      "⚠️ Contradictions",
      "Two things recorded as current that cannot both be true. An agent will believe whichever it reads first.",
      "#cf222e",
      r.contradictions.map((x) => html`${x.aId ? linkEntry(x.aId, x.a) : x.a} <b>⟷</b> ${x.bId ? linkEntry(x.bId, x.b) : x.b}`),
    )}
    ${card(
      "🕳️ Incidents with no decision",
      "Something went wrong repeatedly and nothing was decided about it. These are the gaps that bite twice.",
      "#bc4c00",
      r.gaps.map((g) => html`<a href="${searchLink(g.area)}"><b>${g.area}</b></a> <span class="sub">(${g.type})</span> — ${g.incidents} ${g.incidents === 1 ? "incident" : "incidents"}, no decisions`),
    )}
    ${card(
      "🔁 Possible duplicates",
      "The same thing recorded twice. Harmless until they drift apart and become a contradiction.",
      "#9a6700",
      r.duplicates.map((d) => html`${badge(d.score.toFixed(2), "#9a6700")} ${d.aId ? linkEntry(d.aId, d.a) : d.a} <b>≈</b> ${d.bId ? linkEntry(d.bId, d.b) : d.b}`),
    )}
    ${card(
      "🧩 Orphan entities",
      "Names mentioned once and never connected to anything. Usually a typo or a one-off.",
      "#57606a",
      r.orphanEntities.map((e) => html`<a href="${searchLink(e.name)}">${e.name}</a> <span class="sub">(${e.type})</span>`),
    )}
    ${panel(
      "Nobody has reviewed these",
      r.neverReviewed
        ? html`<p class="sub">
              <b>${r.neverReviewed}</b> of this project's current entries have never been confirmed or corrected by a
              person. Agents wrote them; until somebody says whether they hold, confidence and status carry no
              information and the pack cannot favour what is trustworthy.
            </p>
            <a class="button secondary" href="/p/${project.slug}?status=pending_validation">Start reviewing</a>`
        : html`<p class="sub">Everything current has been through a person. That is what makes the rest worth trusting.</p>`,
      { actions: badge(String(r.neverReviewed), r.neverReviewed ? "#9a5b00" : "#0f7b3d") },
    )}
    ${panel(
      "Other numbers",
      html`<p class="sub">
        Low confidence: <b>${r.lowConfidence}</b> · superseded or obsolete: <b>${r.staleHistorical}</b> ·
        total entries: <b>${r.totalEntries}</b>
      </p>`,
    )}`;
  return c.html(layout(`${project.name} · Health`, body, { user }));
});

// --- Across this client -------------------------------------------------------------------

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

  const { sharedStack, contradictions } = await getAcrossClient(project, user.email);
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

  const body = html`
    ${projectHeader(res, "across")}
    <p class="sub">
      What these ${children.length} projects have in common, and where they disagree. Each project only ever reads
      what this client knows, never what a sibling knows — so this is the one place a conflict between two of
      them can show up.
    </p>
    ${panel("Shared across these projects", stack, {
      help:
        "Technologies, modules, services, integrations and vendors that appear in the memory of two or more of them. It is what has been written down, not an inventory of the architecture.",
      actions: badge(String(sharedStack.length), sharedStack.length ? "#1a6dff" : "#5b6673"),
    })}
    ${panel("Contradictions between projects", choques, {
      help:
        "Two things recorded as current in different projects that cannot both be true. An agent in either one will only ever see its own side.",
      actions: badge(String(contradictions.length), contradictions.length ? "#cf222e" : "#5b6673"),
    })}`;
  return c.html(layout(`${project.name} · Across this client`, body, { user }));
});

// --- Map (graph) --------------------------------------------------------------------------

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

  const body = html`
    ${projectHeader(res, "map")}
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
    <script src="/graph.js"></script>`;
  return c.html(layout(`${project.name} · Map`, body, { user }));
});

// --- Code ---------------------------------------------------------------------------------

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

  const body = html`
    ${projectHeader(res, "code")}
    ${panel(null, searchForm(`/p/${project.slug}/code`, q, "e.g. where is the user's phone number verified"), {
      help: "Hybrid search, semantic and lexical, over this project's indexed code.",
    })}
    ${q ? html`<h2 style="font-size:16px">"${q}"</h2>${results}` : ""}`;
  return c.html(layout(`${project.name} · Code`, body, { user }));
});

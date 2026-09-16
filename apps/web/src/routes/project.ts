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
  getContextPack,
  lintProject,
  listAccessibleProjects,
  listEntries,
  renderContextPack,
  searchProjectCode,
} from "@cortex/core";
import { askProjectContext } from "@cortex/agents";
import { layout, type Html } from "../views/layout.js";
import { badge, empty, entryCard, joinHtml, panel, scoreBadge, searchForm, statusBadge, typeBadge } from "../views/components.js";
import { mdLite } from "../views/md.js";
import { projectHeader } from "../views/project-nav.js";
import { requireProjectPage } from "../middleware/access.js";
import type { WebEnv } from "../middleware/session.js";

/**
 * Todo lo que se mira DENTRO de un proyecto, bajo `/p/<slug>/…` (ADR-0050).
 *
 * Antes cada una de estas pantallas era una ruta global con su propio selector de proyecto, y
 * pasar de una a otra te devolvía al primero de la lista. Con el slug en la URL el proyecto no
 * se puede perder, que era el problema de verdad.
 */
export const projectRoutes = new Hono<WebEnv>();

/** Enlaza una entrada del pack o del lint: ver algo que está mal y no poder tocarlo enseña a
 *  ignorar los avisos, que es exactamente lo que no queremos (ADR-0050). */
const linkEntry = (id: string, texto: Html | string): Html => html`<a href="/entry/${id}">${texto}</a>`;

// --- Memory ------------------------------------------------------------------------------

projectRoutes.get("/p/:slug", async (c) => {
  const user = c.get("user")!;
  const res = await requireProjectPage(c, c.req.param("slug"));
  if (res instanceof Response) return res;
  const { project, gestor } = res;

  const typeParsed = contextEntryType.safeParse(c.req.query("type"));
  const type: ContextEntryType | undefined = typeParsed.success ? typeParsed.data : undefined;
  const statusParsed = contextEntryStatus.safeParse(c.req.query("status"));
  const status: ContextEntryStatus | undefined = statusParsed.success ? statusParsed.data : undefined;
  const showCapture = c.req.query("capture") === "1";

  const entries = await listEntries({ project: project.name, type, status, limit: 60 });
  const base = `/p/${project.slug}`;
  const conFiltros = (extra: Record<string, string>) => {
    const qs = new URLSearchParams({ ...(type ? { type } : {}), ...(status ? { status } : {}), ...extra });
    for (const [k, v] of [...qs]) if (!v) qs.delete(k);
    return qs.toString() ? `${base}?${qs}` : base;
  };

  const typePills = [
    html`<a class="pill ${!type ? "active" : ""}" href="${conFiltros({ type: "" })}">All types</a>`,
    ...contextEntryType.options.map(
      (x) => html`<a class="pill ${type === x ? "active" : ""}" href="${conFiltros({ type: x })}">${x}</a>`,
    ),
  ];

  // Filtrar por estado es lo que convierte «348 sin revisar» en una lista por la que empezar.
  const statusPills = [
    html`<a class="pill ${!status ? "active" : ""}" href="${conFiltros({ status: "" })}">Any status</a>`,
    ...contextEntryStatus.options.map(
      (x) => html`<a class="pill ${status === x ? "active" : ""}" href="${conFiltros({ status: x })}">${x}</a>`,
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
        { ayuda: "Normally your agents write here. This is for what you know and they do not." },
      )
    : html``;

  const body = html`
    ${projectHeader(project, "memory", gestor)}
    <div class="section-bar">
      ${searchForm("/search", "", "Search this project by meaning…", { project: project.name })}
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
  const { project, gestor } = res;
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
    ${projectHeader(project, "ask", gestor)}
    ${panel(
      null,
      html`<form class="row" method="get" action="/p/${project.slug}/ask">
        <input type="text" name="q" placeholder="e.g. what should I watch out for in the billing module?" value="${q}" required autofocus>
        <button type="submit">Ask</button>
      </form>`,
      { ayuda: "The retrieval agent answers from what is saved, and cites what it used." },
    )}
    ${q ? html`<h2 style="font-size:17px">${q}</h2>${answerHtml}` : ""}`;
  return c.html(layout(`${project.name} · Ask`, body, { user }));
});

// --- What agents see (context pack) -------------------------------------------------------

projectRoutes.get("/p/:slug/agents", async (c) => {
  const user = c.get("user")!;
  const res = await requireProjectPage(c, c.req.param("slug"));
  if (res instanceof Response) return res;
  const { project, gestor } = res;

  const area = c.req.query("area") || undefined;
  const asOfStr = c.req.query("asof");
  const asOf = asOfStr ? new Date(asOfStr) : undefined;
  const pack = await getContextPack(project.name, area, asOf);

  const sec = (s: (typeof pack.sections)[number]): Html =>
    s.entries.length
      ? panel(
          s.titulo,
          html`${s.entries.map(
            (e) => html`<div class="pack-entry">
              <div class="card-head">${typeBadge(e.type)} ${statusBadge(e.status)}</div>
              <b>${linkEntry(e.id, e.title)}</b>
              <p class="sub">${e.summary ?? e.content}</p>
            </div>`,
          )}`,
          { acciones: html`<span class="sub">${s.entries.length}</span>` },
        )
      : html``;

  const body = html`
    ${projectHeader(project, "agents", gestor)}
    <p class="sub">
      This is exactly what an agent is told when it opens a session on this project —
      ${pack.totalEntries} ${pack.totalEntries === 1 ? "entry" : "entries"} in total,
      ${asOf ? html`as they stood on <b>${asOfStr ?? ""}</b>` : "as they stand now"}.
    </p>
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

/** El mismo pack en markdown, que es como lo recibe el agente: para pegarlo donde haga falta. */
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
  const { project, gestor } = res;
  const r = await lintProject(project.name);

  const buscar = (texto: string) =>
    `/search?q=${encodeURIComponent(texto)}&project=${encodeURIComponent(project.name)}`;

  const card = (title: string, ayuda: string, color: string, items: Html[]) =>
    panel(
      title,
      items.length
        ? html`<ul class="findings">${items.map((i) => html`<li>${i}</li>`)}</ul>`
        : html`<p class="sub">Nothing to report.</p>`,
      { ayuda, acciones: badge(String(items.length), items.length ? color : "#5b6673") },
    );

  const body = html`
    ${projectHeader(project, "health", gestor)}
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
      r.gaps.map((g) => html`<a href="${buscar(g.area)}"><b>${g.area}</b></a> <span class="sub">(${g.type})</span> — ${g.incidents} ${g.incidents === 1 ? "incident" : "incidents"}, no decisions`),
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
      r.orphanEntities.map((e) => html`<a href="${buscar(e.name)}">${e.name}</a> <span class="sub">(${e.type})</span>`),
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
      { acciones: badge(String(r.neverReviewed), r.neverReviewed ? "#9a5b00" : "#0f7b3d") },
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

// --- Map (graph) --------------------------------------------------------------------------

projectRoutes.get("/p/:slug/map", async (c) => {
  const user = c.get("user")!;
  const res = await requireProjectPage(c, c.req.param("slug"));
  if (res instanceof Response) return res;
  const { project, gestor } = res;
  // El checkbox manda "1" o nada; leerlo como `!== "0"` hacía IMPOSIBLE desmarcarlo desde la
  // UI. Un campo oculto con el valor por defecto delante del checkbox lo arregla sin JS, pero
  // entonces llegan los dos (`?entries=0&entries=1`) y `query()` devuelve el PRIMERO: hay que
  // quedarse con el último o la casilla ya no se puede volver a marcar.
  const incluirEntradas = (c.req.queries("entries")?.at(-1) ?? "1") !== "0";

  const body = html`
    ${projectHeader(project, "map", gestor)}
    <p class="sub">How this project's knowledge connects, and where it does not.</p>
    ${panel(
      null,
      html`<form class="row" method="get" action="/p/${project.slug}/map">
        <input type="hidden" name="entries" value="0">
        <label class="check"><input type="checkbox" name="entries" value="1" ${incluirEntradas ? "checked" : ""}> Include entries</label>
        <button type="submit">Update</button>
      </form>`,
    )}
    <div id="legend"></div>
    <div id="net" data-project="${project.name}" data-entries="${incluirEntradas ? "1" : "0"}"></div>
    <script src="https://unpkg.com/vis-network@9.1.9/standalone/umd/vis-network.min.js"></script>
    <script src="/graph.js"></script>`;
  return c.html(layout(`${project.name} · Map`, body, { user }));
});

// --- Code ---------------------------------------------------------------------------------

projectRoutes.get("/p/:slug/code", async (c) => {
  const user = c.get("user")!;
  const res = await requireProjectPage(c, c.req.param("slug"));
  if (res instanceof Response) return res;
  const { project, gestor } = res;
  const q = c.req.query("q") ?? "";

  let results: Html = html``;
  if (q) {
    const hits = await searchProjectCode(q, project.name, 10);
    results = hits.length
      ? html`${hits.map((h) => {
          const cuerpo = h.content.startsWith("// ") ? h.content.slice(h.content.indexOf("\n") + 1) : h.content;
          return html`<section class="panel">
            <div class="card-head">${scoreBadge(h.score)} <b>${h.path}</b>
              <span class="sub">:${h.startLine}-${h.endLine} · ${h.language ?? ""}</span></div>
            <pre class="content-block" style="overflow:auto"><code>${cuerpo}</code></pre>
          </section>`;
        })}`
      : empty(html`No results. Has this repository been indexed? An operator runs <code>cortex-admin index-code</code>.`);
  }

  const body = html`
    ${projectHeader(project, "code", gestor)}
    ${panel(null, searchForm(`/p/${project.slug}/code`, q, "e.g. where is the user's phone number verified"), {
      ayuda: "Hybrid search, semantic and lexical, over this project's indexed code.",
    })}
    ${q ? html`<h2 style="font-size:16px">"${q}"</h2>${results}` : ""}`;
  return c.html(layout(`${project.name} · Code`, body, { user }));
});

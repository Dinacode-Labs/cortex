import { serve } from "@hono/node-server";
import { Hono } from "hono";
import { closeSql } from "@cortex/database";
import {
  type ContextEntryStatus,
  contextEntryType,
  loadEnv,
} from "@cortex/shared";
import {
  getContextPack,
  getEntryDetail,
  getProjectGraph,
  getUsageSummary,
  lintProject,
  listEntries,
  listProjects,
  searchProjectCode,
  saveContext,
  searchContext,
  setClassifier,
  setReranker,
  validateEntry,
} from "@cortex/core";
import { classifyEntry, isLlmEnabled, rerankLLM, synthesizeContextAnswer } from "@cortex/agents";
import { badge, confidenceBadge, entryCard, esc, layout, mdLite, statusBadge, typeBadge } from "./views.js";

/**
 * UI mínima de demo (§16). Renderizado en servidor (Hono), sin build de
 * frontend. Es un segundo consumidor de @cortex/core, demostrando que humanos y
 * agentes comparten la misma capa de contexto (§5.4).
 */

loadEnv();
if (isLlmEnabled()) {
  setClassifier(classifyEntry);
  if (process.env.CORTEX_RERANK !== "off") setReranker(rerankLLM);
}
const app = new Hono();

// --- Dashboard ---------------------------------------------------------------
app.get("/", async (c) => {
  const project = c.req.query("project");
  const type = c.req.query("type");
  const showCapture = c.req.query("capture") === "1";

  const projects = await listProjects();
  const entries = await listEntries({
    project: project || undefined,
    type: (type as never) || undefined,
    limit: 60,
  });

  const projectPills = [
    `<a class="pill ${!project ? "active" : ""}" href="/">Todos</a>`,
    ...projects.map(
      (p) =>
        `<a class="pill ${project === p.entity.name ? "active" : ""}" href="/?project=${encodeURIComponent(p.entity.name)}">${esc(p.entity.name)} (${p.entryCount})</a>`,
    ),
  ].join("");

  const typePills = [
    `<a class="pill ${!type ? "active" : ""}" href="/${project ? `?project=${encodeURIComponent(project)}` : ""}">Todos los tipos</a>`,
    ...contextEntryType.options.map((t) => {
      const qs = new URLSearchParams();
      if (project) qs.set("project", project);
      qs.set("type", t);
      return `<a class="pill ${type === t ? "active" : ""}" href="/?${qs.toString()}">${esc(t)}</a>`;
    }),
  ].join("");

  const captureForm = showCapture
    ? `<div class="panel">
        <h2>Capturar contexto</h2>
        <form method="post" action="/save">
          <textarea name="content" placeholder="Escribe el conocimiento a guardar (decisión, restricción, incidencia...)" required></textarea>
          <div class="row" style="margin-top:8px">
            <input type="text" name="project" placeholder="Proyecto" value="${esc(project ?? "")}">
            <select name="type">
              <option value="">(clasificar automáticamente)</option>
              ${contextEntryType.options.map((t) => `<option value="${t}">${t}</option>`).join("")}
            </select>
            <button type="submit">Guardar en Cortex</button>
          </div>
        </form>
      </div>`
    : "";

  const packLink = project
    ? `<a class="pill" href="/pack?project=${encodeURIComponent(project)}">📦 Context pack de ${esc(project)}</a>
       <a class="pill" href="/ask?project=${encodeURIComponent(project)}">💬 Preguntar sobre ${esc(project)}</a>`
    : "";

  const body = `
    <h1>Memoria de contexto</h1>
    <p class="sub">${entries.length} entradas · ${projects.length} proyectos</p>

    <div class="panel">
      <form class="row" method="get" action="/search">
        <input type="text" name="q" placeholder="Buscar semánticamente en Cortex..." required>
        ${project ? `<input type="hidden" name="project" value="${esc(project)}">` : ""}
        <button type="submit">Buscar</button>
        <a href="/?capture=1${project ? `&project=${encodeURIComponent(project)}` : ""}"><button type="button" class="secondary">+ Capturar</button></a>
      </form>
    </div>

    ${captureForm}

    <div class="filters">
      <div>${projectPills}</div>
      <div style="margin-top:8px">${typePills}</div>
      ${packLink ? `<div style="margin-top:8px">${packLink}</div>` : ""}
    </div>

    ${entries.length ? `<div class="grid">${entries.map(entryCard).join("")}</div>` : `<div class="empty">No hay entradas con estos filtros.</div>`}
  `;
  return c.html(layout("Inicio", body));
});

// --- Búsqueda ----------------------------------------------------------------
app.get("/search", async (c) => {
  const q = c.req.query("q") ?? "";
  const project = c.req.query("project");
  const hits = q ? await searchContext({ query: q, project: project || undefined, limit: 15 }) : [];

  const results = hits.length
    ? `<div class="grid">${hits
        .map(
          (h) =>
            `<a class="card" href="/entry/${esc(h.entry.id)}">
              <div class="card-head">${badge(h.score.toFixed(2), "#0099ff")} ${typeBadge(h.entry.type)} ${statusBadge(h.entry.status)}</div>
              <h3>${esc(h.entry.title)}</h3>
              <p>${esc(h.entry.summary ?? h.entry.content)}</p>
            </a>`,
        )
        .join("")}</div>`
    : `<div class="empty">${q ? "Sin resultados relevantes." : "Escribe una consulta."}</div>`;

  const body = `
    <p><a class="back" href="/">← Inicio</a></p>
    <h1>Resultados para "${esc(q)}"</h1>
    <p class="sub">${hits.length} resultados${project ? ` · proyecto ${esc(project)}` : ""} · ordenados por similitud</p>
    ${results}`;
  return c.html(layout(`Búsqueda: ${q}`, body));
});

// --- Detalle de entrada ------------------------------------------------------
app.get("/entry/:id", async (c) => {
  const detail = await getEntryDetail(c.req.param("id"));
  if (!detail) return c.html(layout("No encontrado", `<p><a class="back" href="/">← Inicio</a></p><div class="empty">Entrada no encontrada.</div>`), 404);
  const { entry, source, entities, projectName } = detail;

  const entityTags = entities.length
    ? `<div class="tags">${entities.map((e) => `<a href="/search?q=${encodeURIComponent(e.name)}">#${esc(e.name)} <small>(${esc(e.type)})</small></a>`).join("")}</div>`
    : '<span class="sub">Sin entidades enlazadas.</span>';

  const validateForm = (status: ContextEntryStatus, label: string) =>
    `<form method="post" action="/entry/${esc(entry.id)}/validate" style="display:inline">
      <input type="hidden" name="status" value="${status}">
      <button class="secondary" type="submit">${label}</button>
    </form>`;

  const iso = (d: unknown) => (d instanceof Date ? d.toISOString().slice(0, 10) : String(d ?? "").slice(0, 10));
  const temporalBadge = entry.validTo
    ? badge(`no vigente desde ${iso(entry.validTo)}`, "#cf222e")
    : badge("vigente", "#1a7f37");

  const body = `
    <p><a class="back" href="/">← Inicio</a></p>
    <div class="card-head" style="margin-bottom:8px">${typeBadge(entry.type)} ${statusBadge(entry.status)} ${confidenceBadge(entry.confidence)} ${temporalBadge}</div>
    <h1>${esc(entry.title)}</h1>

    <div class="content-block">${esc(entry.content)}</div>

    <div class="panel" style="margin-top:18px">
      <h2>Metadatos</h2>
      <dl class="meta">
        <dt>Proyecto</dt><dd>${esc(projectName ?? "—")}</dd>
        <dt>Tipo</dt><dd>${esc(entry.type)}</dd>
        <dt>Estado</dt><dd>${statusBadge(entry.status)}</dd>
        <dt>Confianza</dt><dd>${esc(entry.confidence)}</dd>
        <dt>Fuente</dt><dd>${esc(entry.sourceType)}${entry.sourceReference ? ` · ${esc(entry.sourceReference)}` : ""}</dd>
        <dt>Autor</dt><dd>${esc(entry.createdBy ?? "—")}</dd>
        <dt>Vigencia</dt><dd>${entry.validTo ? `cerrada el ${iso(entry.validTo)} (${esc(entry.validity)})` : "vigente"}</dd>
        <dt>Válida desde</dt><dd>${iso(entry.validFrom)}</dd>
        <dt>Creada</dt><dd>${esc(entry.createdAt instanceof Date ? entry.createdAt.toISOString() : entry.createdAt)}</dd>
      </dl>
    </div>

    <div class="panel">
      <h2>Entidades relacionadas</h2>
      ${entityTags}
    </div>

    ${source?.rawContent ? `<div class="panel"><h2>Fuente original</h2><div class="content-block">${esc(source.rawContent)}</div></div>` : ""}

    <div class="panel">
      <h2>Validación</h2>
      ${validateForm("validated", "✅ Validar")}
      ${validateForm("rejected", "✖ Rechazar")}
      ${validateForm("obsolete", "🗄 Marcar obsoleta")}
    </div>`;
  return c.html(layout(entry.title, body));
});

app.post("/entry/:id/validate", async (c) => {
  const id = c.req.param("id");
  const form = await c.req.parseBody();
  const status = String(form.status) as "validated" | "rejected" | "obsolete";
  await validateEntry(id, status);
  return c.redirect(`/entry/${id}`);
});

// --- Guardar contexto --------------------------------------------------------
app.post("/save", async (c) => {
  const form = await c.req.parseBody();
  const content = String(form.content ?? "").trim();
  if (!content) return c.redirect("/?capture=1");
  const project = String(form.project ?? "").trim() || undefined;
  const typeRaw = String(form.type ?? "").trim();
  const type = typeRaw ? (typeRaw as never) : undefined;

  const { entry, warnings } = await saveContext({ content, project, type, createdBy: "web-ui" });

  const warnHtml = warnings
    .map(
      (w) =>
        `<div class="warn ${w.kind === "possible_contradiction" ? "contradiction" : ""}">⚠️ ${esc(w.message)}</div>`,
    )
    .join("");

  const body = `
    <p><a class="back" href="/">← Inicio</a></p>
    <h1>Guardado en Cortex</h1>
    <p class="sub">Clasificado como ${typeBadge(entry.type)} · estado ${statusBadge(entry.status)}</p>
    ${warnHtml || '<p class="sub">Sin señales del loop de mejora.</p>'}
    <p style="margin-top:16px"><a href="/entry/${esc(entry.id)}"><button>Ver entrada</button></a>
    <a href="/?capture=1"><button class="secondary">Capturar otra</button></a></p>`;
  return c.html(layout("Guardado", body));
});

// --- Preguntar (agente de recuperación) --------------------------------------
app.get("/ask", async (c) => {
  const q = c.req.query("q") ?? "";
  const project = c.req.query("project") || undefined;
  const projects = await listProjects();

  let answerHtml = "";
  if (q) {
    const hits = await searchContext({ query: q, project, limit: 6 });
    const answer = await synthesizeContextAnswer(
      q,
      hits.map((h) => ({ title: h.entry.title, summary: h.entry.summary ?? h.entry.content, type: h.entry.type })),
    );
    const sources = hits.length
      ? `<div class="panel"><h2>Fuentes consultadas</h2>${hits
          .map((h) => `<div style="margin-bottom:8px">${badge(h.score.toFixed(2), "#0099ff")} <a href="/entry/${esc(h.entry.id)}">${esc(h.entry.title)}</a></div>`)
          .join("")}</div>`
      : `<div class="empty">Sin contexto relevante.</div>`;
    answerHtml = answer
      ? `<div class="answer">${mdLite(answer)}</div>${sources}`
      : `<div class="warn">⚠️ LLM no configurado (LLM_PROVIDER=openrouter). Mostrando solo la búsqueda.</div>${sources}`;
  }

  const projectOptions = [
    `<option value="">(todos los proyectos)</option>`,
    ...projects.map((p) => `<option value="${esc(p.entity.name)}" ${project === p.entity.name ? "selected" : ""}>${esc(p.entity.name)}</option>`),
  ].join("");

  const body = `
    <p><a class="back" href="/">← Inicio</a></p>
    <h1>Preguntar a Cortex</h1>
    <p class="sub">El agente de recuperación (Mastra) responde fundamentándose en el contexto guardado.</p>
    <div class="panel">
      <form class="row" method="get" action="/ask">
        <input type="text" name="q" placeholder="p.ej. ¿qué cuidados con el módulo de facturación?" value="${esc(q)}" required>
        <select name="project">${projectOptions}</select>
        <button type="submit">Preguntar</button>
      </form>
    </div>
    ${q ? `<h2 style="font-size:17px">${esc(q)}</h2>${answerHtml}` : ""}`;
  return c.html(layout("Preguntar", body));
});

// --- Context pack ------------------------------------------------------------
app.get("/pack", async (c) => {
  const project = c.req.query("project") ?? "";
  const area = c.req.query("area") || undefined;
  const asOfStr = c.req.query("asof");
  const asOf = asOfStr ? new Date(asOfStr) : undefined;
  let pack;
  try {
    pack = await getContextPack(project, area, asOf);
  } catch {
    return c.html(layout("Context pack", `<p><a class="back" href="/">← Inicio</a></p><div class="empty">Proyecto no encontrado.</div>`), 404);
  }

  const sec = (title: string, entries: typeof pack.decisions) =>
    entries.length
      ? `<div class="panel"><h2>${esc(title)}</h2>${entries
          .map((e) => `<div style="margin-bottom:10px">${typeBadge(e.type)} ${statusBadge(e.status)}<br><b>${esc(e.title)}</b><br><span class="sub">${esc(e.summary ?? e.content)}</span></div>`)
          .join("")}</div>`
      : "";

  const body = `
    <p><a class="back" href="/">← Inicio</a></p>
    <h1>Context Pack — ${esc(pack.project)}</h1>
    <p class="sub">${pack.totalEntries} entradas · ${asOf ? `vigente a fecha <b>${esc(asOfStr ?? "")}</b>` : "estado actual"} · generado ${esc(pack.generatedAt.toISOString())}</p>
    <form class="row" method="get" action="/pack" style="margin-bottom:16px">
      <input type="hidden" name="project" value="${esc(pack.project)}">
      <input type="text" name="area" placeholder="Área/módulo, p.ej. facturación" value="${esc(area ?? "")}">
      <input type="date" name="asof" value="${esc(asOfStr ?? "")}" title="Point-in-time: contexto vigente a esta fecha">
      <button type="submit">Generar</button>
    </form>
    ${asOf ? `<div class="warn">⏳ Vista <b>point-in-time</b>: hechos vigentes el ${esc(asOfStr ?? "")} (incluye los que después se invalidaron).</div>` : ""}
    ${sec("Decisiones técnicas vigentes", pack.decisions)}
    ${sec("Restricciones activas", pack.constraints)}
    ${sec("Riesgos conocidos", pack.risks)}
    ${sec("Deuda técnica", pack.technicalDebt)}
    ${sec("Convenciones", pack.conventions)}
    ${pack.sensitiveModules.length ? `<div class="panel"><h2>Módulos sensibles</h2>${pack.sensitiveModules.map((m) => badge(m, "#bc4c00")).join(" ")}</div>` : ""}
    ${pack.relevantToArea.length ? `<div class="panel"><h2>Relevante para "${esc(area ?? "")}"</h2>${pack.relevantToArea.map((h) => `<div style="margin-bottom:8px">${badge(h.score.toFixed(2), "#0099ff")} ${esc(h.entry.title)}</div>`).join("")}</div>` : ""}
  `;
  return c.html(layout(`Context Pack: ${pack.project}`, body));
});

// --- Búsqueda de código ------------------------------------------------------
app.get("/code", async (c) => {
  const q = c.req.query("q") ?? "";
  const projects = await listProjects();
  const project = c.req.query("project") || projects[0]?.entity.name || "";
  const projectOptions = projects
    .map((p) => `<option value="${esc(p.entity.name)}" ${project === p.entity.name ? "selected" : ""}>${esc(p.entity.name)}</option>`)
    .join("");

  let results = "";
  if (q && project) {
    const hits = await searchProjectCode(q, project, 10);
    results = hits.length
      ? hits
          .map((h) => {
            const body = h.content.startsWith("// ") ? h.content.slice(h.content.indexOf("\n") + 1) : h.content;
            return `<div class="panel"><div class="card-head">${badge(h.score.toFixed(2), "#0099ff")} <b>${esc(h.path)}</b> <span class="sub">:${h.startLine}-${h.endLine} · ${esc(h.language ?? "")}</span></div><pre class="content-block" style="overflow:auto"><code>${esc(body)}</code></pre></div>`;
          })
          .join("")
      : `<div class="empty">Sin resultados. ¿Has indexado el repo? (pnpm --filter @cortex/core index-code)</div>`;
  }

  const body = `
    <p><a class="back" href="/">← Inicio</a></p>
    <h1>Búsqueda de código</h1>
    <p class="sub">Búsqueda híbrida (semántica + léxica) sobre el código indexado del proyecto.</p>
    <div class="panel">
      <form class="row" method="get" action="/code">
        <input type="text" name="q" placeholder="p.ej. dónde se verifica el teléfono del usuario" value="${esc(q)}" required>
        <select name="project">${projectOptions}</select>
        <button type="submit">Buscar</button>
      </form>
    </div>
    ${q ? `<h2 style="font-size:16px">"${esc(q)}"</h2>${results}` : ""}`;
  return c.html(layout("Código", body));
});

// --- Lint (curado / salud del conocimiento) ----------------------------------
app.get("/lint", async (c) => {
  const projects = await listProjects();
  const project = c.req.query("project") || projects[0]?.entity.name || "";
  const projectOptions = projects
    .map((p) => `<option value="${esc(p.entity.name)}" ${project === p.entity.name ? "selected" : ""}>${esc(p.entity.name)} (${p.entryCount})</option>`)
    .join("");

  let report = "";
  if (project) {
    try {
      const r = await lintProject(project);
      const card = (title: string, color: string, items: string[]) =>
        `<div class="panel"><h2>${esc(title)} <span class="badge" style="background:${color}1a;color:${color};border:1px solid ${color}55">${items.length}</span></h2>${items.length ? `<ul style="margin:0;padding-left:18px">${items.map((i) => `<li>${i}</li>`).join("")}</ul>` : '<span class="sub">Nada que reportar.</span>'}</div>`;
      report = [
        card("⚠️ Contradicciones", "#cf222e", r.contradictions.map((x) => `${esc(x.a)} <b>⟷</b> ${esc(x.b)}`)),
        card("🕳️ Huecos: incidencias sin decisiones", "#bc4c00", r.gaps.map((g) => `<b>${esc(g.area)}</b> <span class="sub">(${esc(g.type)})</span> — ${g.incidents} incidencias, 0 decisiones`)),
        card("🔁 Posibles duplicados", "#9a6700", r.duplicates.map((d) => `(${d.score.toFixed(2)}) ${esc(d.a)} <b>≈</b> ${esc(d.b)}`)),
        card("🧩 Entidades huérfanas", "#57606a", r.orphanEntities.map((e) => `${esc(e.type)}: ${esc(e.name)}`)),
        `<div class="panel"><h2>📉 Otros</h2><div class="sub">Baja confianza: <b>${r.lowConfidence}</b> · Histórico/obsoleto: <b>${r.staleHistorical}</b> · Total entradas: <b>${r.totalEntries}</b></div></div>`,
      ].join("");
    } catch {
      report = `<div class="empty">Proyecto no encontrado.</div>`;
    }
  }

  const body = `
    <p><a class="back" href="/">← Inicio</a></p>
    <h1>Lint del conocimiento</h1>
    <p class="sub">Salud de la memoria del proyecto: contradicciones, huecos, duplicados, entidades huérfanas (loops §12 / patrón LLM Wiki).</p>
    <div class="panel">
      <form class="row" method="get" action="/lint">
        <select name="project">${projectOptions}</select>
        <button type="submit">Analizar</button>
      </form>
    </div>
    ${report}`;
  return c.html(layout("Lint", body));
});

// --- Coste / uso de IA -------------------------------------------------------
app.get("/usage", async (c) => {
  const u = await getUsageSummary();
  const num = (n: number) => n.toLocaleString("es-ES");
  const money = (n: number) => (n > 0 ? `$${n.toFixed(4)}` : "—");
  const th = 'style="text-align:left;padding:6px 10px;border-bottom:1px solid var(--color-border);font-size:12px;color:var(--color-text-muted)"';
  const td = 'style="padding:6px 10px;border-bottom:1px solid var(--color-border)"';
  const tdr = 'style="padding:6px 10px;border-bottom:1px solid var(--color-border);text-align:right;font-variant-numeric:tabular-nums"';
  const stat = (label: string, value: string) =>
    `<div class="panel" style="flex:1;min-width:140px"><div class="sub">${esc(label)}</div><div style="font-size:24px;font-weight:700">${value}</div></div>`;

  const opRows = u.byOperation
    .map((o) => `<tr><td ${td}>${esc(o.operation)} <span class="sub">${esc(o.kind)}</span></td><td ${tdr}>${num(o.calls)}</td><td ${tdr}>${num(o.totalTokens)}</td><td ${tdr}>${money(o.costUsd)}</td></tr>`)
    .join("");
  const modelRows = u.byModel
    .map((m) => `<tr><td ${td}>${esc(m.model)} <span class="sub">${esc(m.provider)}</span></td><td ${tdr}>${num(m.calls)}</td><td ${tdr}>${num(m.totalTokens)}</td><td ${tdr}>${money(m.costUsd)}</td></tr>`)
    .join("");
  const recentRows = u.recent
    .map((r) => `<tr><td ${td}><span class="sub">${esc(r.createdAt.replace("T", " ").slice(0, 19))}</span></td><td ${td}>${esc(r.operation)}</td><td ${td}>${esc(r.model)}</td><td ${tdr}>${num(r.totalTokens)}</td><td ${tdr}>${money(r.costUsd)}</td></tr>`)
    .join("");
  const table = (head: string, rows: string) =>
    `<table style="width:100%;border-collapse:collapse">${head}${rows || `<tr><td ${td} colspan="5"><span class="sub">Sin datos todavía.</span></td></tr>`}</table>`;

  const body = `
    <p><a class="back" href="/">← Inicio</a></p>
    <h1>Coste / uso de IA</h1>
    <p class="sub">Observabilidad de tokens y coste por operación y modelo (ADR-0016). El coste se estima con precios públicos por modelo; <b>nan = gratis</b>, por eso $0 hoy.</p>
    <div class="row" style="display:flex;gap:12px;flex-wrap:wrap">
      ${stat("Llamadas", num(u.totals.calls))}
      ${stat("Tokens (total)", num(u.totals.totalTokens))}
      ${stat("Tokens in / out", `${num(u.totals.inputTokens)} / ${num(u.totals.outputTokens)}`)}
      ${stat("Coste estimado", money(u.totals.costUsd))}
    </div>
    <div class="panel"><h2>Por operación / agente</h2>${table(`<tr><th ${th}>Operación</th><th ${th} style="text-align:right">Llamadas</th><th ${th} style="text-align:right">Tokens</th><th ${th} style="text-align:right">Coste</th></tr>`, opRows)}</div>
    <div class="panel"><h2>Por modelo</h2>${table(`<tr><th ${th}>Modelo</th><th ${th} style="text-align:right">Llamadas</th><th ${th} style="text-align:right">Tokens</th><th ${th} style="text-align:right">Coste</th></tr>`, modelRows)}</div>
    <div class="panel"><h2>Últimas llamadas</h2>${table(`<tr><th ${th}>Fecha</th><th ${th}>Operación</th><th ${th}>Modelo</th><th ${th} style="text-align:right">Tokens</th><th ${th} style="text-align:right">Coste</th></tr>`, recentRows)}</div>`;
  return c.html(layout("Coste IA", body));
});

// --- Grafo de conocimiento ---------------------------------------------------
app.get("/api/graph", async (c) => {
  const project = c.req.query("project") ?? "";
  const includeEntries = c.req.query("entries") !== "0";
  const graph = await getProjectGraph(project, { includeEntries });
  return c.json(graph);
});

app.get("/graph", async (c) => {
  const projects = await listProjects();
  const project = c.req.query("project") || projects[0]?.entity.name || "";
  const includeEntries = c.req.query("entries") !== "0";
  const projectOptions = projects
    .map((p) => `<option value="${esc(p.entity.name)}" ${project === p.entity.name ? "selected" : ""}>${esc(p.entity.name)} (${p.entryCount})</option>`)
    .join("");

  const body = `
    <p><a class="back" href="/">← Inicio</a></p>
    <h1>Grafo de conocimiento</h1>
    <p class="sub">Entidades (círculos por tipo) y entradas, unidas por relaciones y menciones. Arrastra, haz zoom, clic en una entrada para abrirla.</p>
    <div class="panel">
      <form class="row" method="get" action="/graph">
        <select name="project">${projectOptions}</select>
        <label style="display:flex;align-items:center;gap:6px;font-size:14px">
          <input type="checkbox" name="entries" value="1" ${includeEntries ? "checked" : ""}> incluir entradas
        </label>
        <button type="submit">Ver</button>
      </form>
      <div id="legend" style="margin-top:10px;font-size:12px;color:var(--color-text-muted)"></div>
    </div>
    <div id="net" style="height:72vh;background:var(--brand-ink);border:1px solid var(--color-border);border-radius:10px"></div>
    <script src="https://unpkg.com/vis-network@9.1.9/standalone/umd/vis-network.min.js"></script>
    <script>
      const COLORS = {
        client:"#cf222e", project:"#8250df", service:"#0969da", integration:"#1f883d",
        vendor:"#bf3989", technology:"#9a6700", module:"#bc4c00", person:"#57606a",
        decision:"#0a7ea4", incident:"#d1242f", repository:"#0099ff",
      };
      const entryColor = "#33415e";
      function colorFor(group){
        if(group && group.startsWith("entry:")) return entryColor;
        return COLORS[group] || "#768390";
      }
      (async () => {
        const params = new URLSearchParams(location.search);
        const project = ${JSON.stringify(project)};
        const entries = ${includeEntries ? "1" : "0"};
        const res = await fetch("/api/graph?project="+encodeURIComponent(project)+"&entries="+entries);
        const g = await res.json();
        const deg = {};
        g.edges.forEach(e => { deg[e.from]=(deg[e.from]||0)+1; deg[e.to]=(deg[e.to]||0)+1; });
        const nodes = g.nodes.map(n => ({
          id:n.id, label:n.label, shape: n.kind==="entry"?"box":"dot",
          size: 8 + Math.min(22, (deg[n.id]||0)*2),
          color:{background:colorFor(n.group), border:"#ffffff22"},
          font:{color:"#c9d1d9", size: n.kind==="entry"?11:13},
          _kind:n.kind, _group:n.group,
        }));
        const edges = g.edges.map(e => ({
          from:e.from, to:e.to, label: e.kind==="relation"? e.label : undefined,
          arrows: e.kind==="relation"?"to":undefined,
          color:{color: e.kind==="relation"?"#0099ff88":"#ffffff14"},
          font:{color:"#8b949e", size:9, strokeWidth:0},
          dashes: e.kind==="mention",
        }));
        const data={nodes:new vis.DataSet(nodes), edges:new vis.DataSet(edges)};
        const net=new vis.Network(document.getElementById("net"), data, {
          physics:{barnesHut:{gravitationalConstant:-8000, springLength:120, springConstant:0.03}, stabilization:{iterations:200}},
          interaction:{hover:true, tooltipDelay:120},
          nodes:{borderWidth:1},
        });
        net.on("click", p => {
          if(!p.nodes.length) return;
          const n = data.nodes.get(p.nodes[0]);
          if(n && n._kind==="entry") window.location = "/entry/"+n.id;
        });
        const types=[...new Set(g.nodes.map(n=>n._group||n.group).filter(x=>x&&!x.startsWith("entry:")))];
        document.getElementById("legend").innerHTML =
          "Nodos: "+g.nodes.length+" · Aristas: "+g.edges.length+" &nbsp; | &nbsp; " +
          types.map(t=>'<span style="color:'+colorFor(t)+'">●</span> '+t).join(" &nbsp; ") +
          ' &nbsp; <span style="color:'+entryColor+'">▦</span> entrada';
      })();
    </script>`;
  return c.html(layout("Grafo", body));
});

const port = Number(process.env.WEB_PORT ?? 8080);
const server = serve({ fetch: app.fetch, port }, (info) => {
  console.log(`[cortex-web] UI en http://localhost:${info.port}`);
});

const shutdown = async () => {
  server.close();
  await closeSql().catch(() => {});
  process.exit(0);
};
process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);

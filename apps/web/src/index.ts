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
  listEntries,
  listProjects,
  saveContext,
  searchContext,
  setClassifier,
  validateEntry,
} from "@cortex/core";
import { classifyEntry, isLlmEnabled, synthesizeContextAnswer } from "@cortex/agents";
import { badge, confidenceBadge, entryCard, esc, layout, mdLite, statusBadge, typeBadge } from "./views.js";

/**
 * UI mínima de demo (§16). Renderizado en servidor (Hono), sin build de
 * frontend. Es un segundo consumidor de @cortex/core, demostrando que humanos y
 * agentes comparten la misma capa de contexto (§5.4).
 */

loadEnv();
if (isLlmEnabled()) setClassifier(classifyEntry);
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
              <div class="card-head">${badge(h.score.toFixed(2), "#6e4cff")} ${typeBadge(h.entry.type)} ${statusBadge(h.entry.status)}</div>
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

  const body = `
    <p><a class="back" href="/">← Inicio</a></p>
    <div class="card-head" style="margin-bottom:8px">${typeBadge(entry.type)} ${statusBadge(entry.status)} ${confidenceBadge(entry.confidence)} ${badge("vigencia: " + entry.validity, "#57606a")}</div>
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
          .map((h) => `<div style="margin-bottom:8px">${badge(h.score.toFixed(2), "#6e4cff")} <a href="/entry/${esc(h.entry.id)}">${esc(h.entry.title)}</a></div>`)
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
  let pack;
  try {
    pack = await getContextPack(project, area);
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
    <p class="sub">${pack.totalEntries} entradas · generado ${esc(pack.generatedAt.toISOString())}</p>
    <form class="row" method="get" action="/pack" style="margin-bottom:16px">
      <input type="hidden" name="project" value="${esc(pack.project)}">
      <input type="text" name="area" placeholder="Área/módulo, p.ej. facturación" value="${esc(area ?? "")}">
      <button type="submit">Enfocar área</button>
    </form>
    ${sec("Decisiones técnicas vigentes", pack.decisions)}
    ${sec("Restricciones activas", pack.constraints)}
    ${sec("Riesgos conocidos", pack.risks)}
    ${sec("Deuda técnica", pack.technicalDebt)}
    ${sec("Convenciones", pack.conventions)}
    ${pack.sensitiveModules.length ? `<div class="panel"><h2>Módulos sensibles</h2>${pack.sensitiveModules.map((m) => badge(m, "#bc4c00")).join(" ")}</div>` : ""}
    ${pack.relevantToArea.length ? `<div class="panel"><h2>Relevante para "${esc(area ?? "")}"</h2>${pack.relevantToArea.map((h) => `<div style="margin-bottom:8px">${badge(h.score.toFixed(2), "#6e4cff")} ${esc(h.entry.title)}</div>`).join("")}</div>` : ""}
  `;
  return c.html(layout(`Context Pack: ${pack.project}`, body));
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
      <div id="legend" style="margin-top:10px;font-size:12px;color:var(--muted)"></div>
    </div>
    <div id="net" style="height:72vh;background:#0d1117;border:1px solid var(--line);border-radius:10px"></div>
    <script src="https://unpkg.com/vis-network@9.1.9/standalone/umd/vis-network.min.js"></script>
    <script>
      const COLORS = {
        client:"#cf222e", project:"#8250df", service:"#0969da", integration:"#1f883d",
        vendor:"#bf3989", technology:"#9a6700", module:"#bc4c00", person:"#57606a",
        decision:"#0a7ea4", incident:"#d1242f", repository:"#6e4cff",
      };
      const entryColor = "#30363d";
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
          color:{color: e.kind==="relation"?"#6e4cff88":"#ffffff14"},
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

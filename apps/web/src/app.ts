import { Hono, type Context } from "hono";
import { deleteCookie, getCookie, setCookie } from "hono/cookie";
import {
  type ContextEntryStatus,
  contextEntryType,
} from "@cortex/shared";
import {
  getContextPack,
  getEntryDetail,
  getProjectGraph,
  getRecentTraces,
  getUsageSummary,
  lintProject,
  listEntries,
  listProjects,
  searchProjectCode,
  saveContext,
  searchContext,
  validateEntry,
  validateToken,
  redeemUiTicket,
  canAccessProject,
  checkEntryAccess,
  checkProjectAccess,
  listAccessibleProjects,
  listProjectMembers,
  addProjectMember,
  removeProjectMember,
  type AuthUser,
  type ProjectRef,
} from "@cortex/core";
import { synthesizeContextAnswer } from "@cortex/agents";
import { badge, confidenceBadge, entryCard, esc, layout, mdLite, statusBadge, typeBadge } from "./views.js";

/**
 * UI mínima de demo (§16). Renderizado en servidor (Hono), sin build de
 * frontend. Es un segundo consumidor de @cortex/core, demostrando que humanos y
 * agentes comparten la misma capa de contexto (§5.4).
 *
 * Este módulo NO tiene efectos al importar (ni loadEnv ni serve): `createApp()`
 * construye la app completa y el entrypoint fino (`index.ts`) la arranca. Así los
 * tests pueden ejercitar las rutas con `app.request()` sin levantar un servidor.
 */
export type WebEnv = { Variables: { user: AuthUser | null } };

const WEB_COOKIE_TTL = 60 * 60 * 24 * 30; // 30 días

function loginPage(msg = ""): string {
  return layout(
    "Iniciar sesión",
    `<div class="empty" style="max-width:560px;margin:48px auto;text-align:center">
       <h1>Dinacode Cortex</h1>
       <p>Necesitas iniciar sesión para ver el contexto.</p>
       ${msg ? `<p style="color:#c0392b">${esc(msg)}</p>` : ""}
       <p style="margin-top:16px">Desde tu terminal:</p>
       <pre style="text-align:left;display:inline-block">cortex auth login   # una vez por equipo (email + OTP)
cortex ui           # abre esta UI ya autenticada</pre>
     </div>`,
  );
}

/** Proyectos visibles para el usuario (admin → todos), en el shape de listProjects. */
async function accessibleProjects(email: string | null): Promise<Awaited<ReturnType<typeof listProjects>>> {
  const all = await listProjects();
  const out: typeof all = [];
  for (const p of all) if (await canAccessProject({ id: p.entity.id } as ProjectRef, email)) out.push(p);
  return out;
}

const deniedPage = (user: AuthUser | null): string =>
  layout("Sin acceso", `<p><a class="back" href="/">← Inicio</a></p><div class="empty">No tienes acceso a este proyecto (privado). Pide al admin que te añada.</div>`, user);

/** Gate de acceso por nombre de proyecto (política única, checkProjectAccess):
 *  `null` = puede continuar; `Response` = denegación ya renderizada. Proyecto
 *  inexistente → 404 (antes esta UI dejaba pasar); sin acceso → 403 deniedPage.
 *  Sin `name` no hay filtro de proyecto que aplicar → continúa. */
async function requireProject(c: Context<WebEnv>, name: string | undefined | null): Promise<Response | null> {
  if (!name) return null;
  const access = await checkProjectAccess(c.get("user")?.email ?? null, { name });
  if (access.status === "not_found")
    return c.html(layout("No encontrado", `<p><a class="back" href="/">← Inicio</a></p><div class="empty">Proyecto no encontrado.</div>`, c.get("user")), 404);
  if (access.status === "forbidden") return c.html(deniedPage(c.get("user")), 403);
  return null;
}

/** Construye la app web completa (middleware de sesión + rutas). Sin side effects. */
export function createApp(): Hono<WebEnv> {
  const app = new Hono<WebEnv>();

  // Handshake CLI → cookie de sesión. `cortex ui` abre /auth/cli?ticket=… (un solo uso):
  // el ticket se canjea por una sesión web nueva (el token de CLI nunca viaja en la URL).
  // Exento del gate.
  app.get("/auth/cli", async (c) => {
    const ticket = c.req.query("ticket");
    const session = ticket ? ((await redeemUiTicket(ticket))?.token ?? null) : null;
    if (!session) return c.html(loginPage("Enlace inválido o caducado. Ejecuta `cortex ui` de nuevo."), 401);
    setCookie(c, "cortex_session", session, { httpOnly: true, sameSite: "Lax", path: "/", maxAge: WEB_COOKIE_TTL });
    return c.redirect("/");
  });
  app.get("/logout", (c) => {
    deleteCookie(c, "cortex_session", { path: "/" });
    return c.html(loginPage("Sesión cerrada."));
  });

  // Gate: el resto de rutas requieren sesión. Resuelve el usuario desde la cookie.
  app.use("*", async (c, next) => {
    const token = getCookie(c, "cortex_session");
    const user = token ? await validateToken(token) : null;
    c.set("user", user);
    if (!user) return c.html(loginPage(), 401);
    await next();
  });

  // --- Proyectos (listado por acceso + gestión de miembros del admin) ----------
  app.get("/projects", async (c) => {
    const user = c.get("user")!;
    const projects = await listAccessibleProjects(user.email); // admin → todos
    const cards = await Promise.all(
      projects.map(async (p) => {
        const vis = p.visibility === "private" ? '<span class="pill" style="background:#fde">privado</span>' : '<span class="pill">público</span>';
        const owner = p.ownerEmail ? ` · dueño <code>${esc(p.ownerEmail)}</code>` : "";
        let members = "";
        if (user.admin && p.visibility === "private" && p.slug) {
          const list = await listProjectMembers(p.slug);
          const chips = list
            .map(
              (m) =>
                `<form method="post" action="/projects/${esc(p.slug!)}/members/remove" style="display:inline">
                   <input type="hidden" name="email" value="${esc(m)}">
                   <span class="pill">${esc(m)} <button type="submit" title="quitar" style="border:0;background:none;cursor:pointer;color:#c0392b">×</button></span>
                 </form>`,
            )
            .join(" ");
          members = `<div style="margin-top:8px">
            <form method="post" action="/projects/${esc(p.slug)}/members" class="row" style="margin-bottom:6px">
              <input type="email" name="email" placeholder="añadir email…" required>
              <button type="submit">Añadir miembro</button>
            </form>
            ${chips || '<span class="sub">Sin miembros (solo dueño y admins).</span>'}
          </div>`;
        }
        return `<div class="panel">
          <h2 style="margin-bottom:4px"><a href="/?project=${encodeURIComponent(p.name)}">${esc(p.name)}</a> ${vis}</h2>
          <div class="sub"><code>${esc(p.slug ?? "")}</code>${owner}</div>
          ${members}
        </div>`;
      }),
    );
    const body = `<p><a class="back" href="/">← Inicio</a></p>
      <h1>Proyectos</h1>
      <p class="sub">${user.admin ? "Eres admin: ves todos y gestionas el acceso a los privados." : "Proyectos a los que tienes acceso."}</p>
      ${cards.join("") || '<div class="empty">No tienes acceso a ningún proyecto todavía.</div>'}`;
    return c.html(layout("Proyectos", body, user));
  });

  app.post("/projects/:slug/members", async (c) => {
    const user = c.get("user")!;
    if (!user.admin) return c.html(layout("Sin permiso", `<div class="empty">Solo un admin gestiona miembros.</div>`, user), 403);
    const email = String((await c.req.parseBody()).email ?? "").trim();
    if (email) await addProjectMember(c.req.param("slug"), email);
    return c.redirect("/projects");
  });

  app.post("/projects/:slug/members/remove", async (c) => {
    const user = c.get("user")!;
    if (!user.admin) return c.html(layout("Sin permiso", `<div class="empty">Solo un admin gestiona miembros.</div>`, user), 403);
    const email = String((await c.req.parseBody()).email ?? "").trim();
    if (email) await removeProjectMember(c.req.param("slug"), email);
    return c.redirect("/projects");
  });

  // --- Dashboard ---------------------------------------------------------------
  app.get("/", async (c) => {
    const project = c.req.query("project");
    const type = c.req.query("type");
    const showCapture = c.req.query("capture") === "1";
    const email = c.get("user")?.email ?? null;

    const denied = await requireProject(c, project);
    if (denied) return denied;
    const projects = await accessibleProjects(email);
    let entries = await listEntries({
      project: project || undefined,
      type: (type as never) || undefined,
      limit: 60,
    });
    if (!project) {
      const ok = new Set(projects.map((p) => p.entity.id));
      entries = entries.filter((e) => e.projectId && ok.has(e.projectId)); // no filtrar entre proyectos sin acceso
    }

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
    return c.html(layout("Inicio", body, c.get("user")));
  });

  // --- Búsqueda ----------------------------------------------------------------
  app.get("/search", async (c) => {
    const q = c.req.query("q") ?? "";
    const project = c.req.query("project");
    const denied = await requireProject(c, project);
    if (denied) return denied;
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
    return c.html(layout(`Búsqueda: ${q}`, body, c.get("user")));
  });

  // --- Detalle de entrada ------------------------------------------------------
  app.get("/entry/:id", async (c) => {
    const id = c.req.param("id");
    // Gate por entrada (checkEntryAccess): sin acceso al proyecto de la entrada → 403.
    const access = await checkEntryAccess(c.get("user")?.email ?? null, id);
    if (access.status === "forbidden") return c.html(deniedPage(c.get("user")), 403);
    const detail = access.status === "ok" ? await getEntryDetail(id) : null;
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
    return c.html(layout(entry.title, body, c.get("user")));
  });

  app.post("/entry/:id/validate", async (c) => {
    const id = c.req.param("id");
    // Mismo gate que la vista de detalle (GET /entry/:id): sin acceso al proyecto de la
    // entrada no se permite cambiar su estado.
    const access = await checkEntryAccess(c.get("user")?.email ?? null, id);
    if (access.status === "not_found") return c.html(layout("No encontrado", `<p><a class="back" href="/">← Inicio</a></p><div class="empty">Entrada no encontrada.</div>`), 404);
    if (access.status === "forbidden") return c.html(deniedPage(c.get("user")), 403);
    const form = await c.req.parseBody();
    const status = String(form.status) as "validated" | "rejected" | "obsolete";
    await validateEntry(id, status);
    return c.redirect(`/entry/${id}`);
  });

  // --- Guardar contexto --------------------------------------------------------
  app.post("/save", async (c) => {
    const user = c.get("user")!;
    const form = await c.req.parseBody();
    const content = String(form.content ?? "").trim();
    if (!content) return c.redirect("/?capture=1");
    const project = String(form.project ?? "").trim() || undefined;
    // EXCEPCIÓN de escritura: proyecto inexistente se PERMITE (saveContext lo auto-crea,
    // ver ADR); solo se deniega el acceso a un proyecto existente restringido.
    if (project) {
      const access = await checkProjectAccess(user.email, { name: project });
      if (access.status === "forbidden") return c.html(deniedPage(user), 403);
    }
    const typeRaw = String(form.type ?? "").trim();
    const type = typeRaw ? (typeRaw as never) : undefined;

    const { entry, warnings } = await saveContext({ content, project, type, createdBy: user.email });

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
    return c.html(layout("Guardado", body, c.get("user")));
  });

  // --- Preguntar (agente de recuperación) --------------------------------------
  app.get("/ask", async (c) => {
    const q = c.req.query("q") ?? "";
    const project = c.req.query("project") || undefined;
    const denied = await requireProject(c, project);
    if (denied) return denied;
    const projects = await accessibleProjects(c.get("user")?.email ?? null);

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
    return c.html(layout("Preguntar", body, c.get("user")));
  });

  // --- Context pack ------------------------------------------------------------
  app.get("/pack", async (c) => {
    const project = c.req.query("project") ?? "";
    const denied = await requireProject(c, project);
    if (denied) return denied;
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
    return c.html(layout(`Context Pack: ${pack.project}`, body, c.get("user")));
  });

  // --- Búsqueda de código ------------------------------------------------------
  app.get("/code", async (c) => {
    const q = c.req.query("q") ?? "";
    const projects = await accessibleProjects(c.get("user")?.email ?? null);
    const project = c.req.query("project") || projects[0]?.entity.name || "";
    const denied = await requireProject(c, project);
    if (denied) return denied;
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
    return c.html(layout("Código", body, c.get("user")));
  });

  // --- Lint (curado / salud del conocimiento) ----------------------------------
  app.get("/lint", async (c) => {
    const projects = await accessibleProjects(c.get("user")?.email ?? null);
    const project = c.req.query("project") || projects[0]?.entity.name || "";
    const denied = await requireProject(c, project);
    if (denied) return denied;
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
    return c.html(layout("Lint", body, c.get("user")));
  });

  // --- Coste / uso de IA -------------------------------------------------------
  app.get("/usage", async (c) => {
    const u = await getUsageSummary();
    const traces = await getRecentTraces(12);
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

    const spanRow = (s: (typeof traces)[number]["spans"][number]) => {
      const indent = s.parentSpanId ? 18 : 0;
      const toks = (s.inputTokens ?? 0) + (s.outputTokens ?? 0);
      return `<div style="padding:3px 0;padding-left:${indent}px;border-bottom:1px solid var(--color-border);font-size:13px">
        <span class="sub" style="font-variant-numeric:tabular-nums">${esc(s.spanType ?? "")}</span>
        ${esc((s.name ?? s.entityName ?? "").slice(0, 80))}
        ${s.durationMs != null ? `<span class="sub"> · ${num(s.durationMs)}ms</span>` : ""}
        ${toks ? `<span class="sub"> · ${num(toks)} tok</span>` : ""}
        ${s.status === "error" ? " ⚠️" : ""}</div>`;
    };
    const tracesHtml = traces.length
      ? traces
          .map(
            (t) =>
              `<div class="panel"><h2 style="font-size:15px;margin-bottom:6px">🧵 ${esc(t.rootName)}
                <span class="sub" style="font-weight:400"> · ${num(t.totalDurationMs)}ms · ${num(t.totalTokens)} tok · ${esc(t.startedAt.replace("T", " ").slice(0, 19))}</span></h2>
                ${t.spans.map(spanRow).join("")}</div>`,
          )
          .join("")
      : `<div class="panel"><span class="sub">Sin trazas todavía. Ejecuta una operación con LLM (ask, enrich…).</span></div>`;

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
      <div class="panel"><h2>Últimas llamadas</h2>${table(`<tr><th ${th}>Fecha</th><th ${th}>Operación</th><th ${th}>Modelo</th><th ${th} style="text-align:right">Tokens</th><th ${th} style="text-align:right">Coste</th></tr>`, recentRows)}</div>
      <h2 style="margin-top:28px">Trazas recientes <span class="sub">· AI tracing de Mastra (árbol de spans)</span></h2>
      ${tracesHtml}`;
    return c.html(layout("Coste IA", body, c.get("user")));
  });

  // --- Grafo de conocimiento ---------------------------------------------------
  app.get("/api/graph", async (c) => {
    const project = c.req.query("project") ?? "";
    // Endpoint JSON (lo consume la página /graph): misma política, respuesta JSON.
    if (project) {
      const access = await checkProjectAccess(c.get("user")?.email ?? null, { name: project });
      if (access.status === "not_found") return c.json({ error: "proyecto no encontrado" }, 404);
      if (access.status === "forbidden") return c.json({ error: "sin acceso" }, 403);
    }
    const includeEntries = c.req.query("entries") !== "0";
    const graph = await getProjectGraph(project, { includeEntries });
    return c.json(graph);
  });

  app.get("/graph", async (c) => {
    const projects = await accessibleProjects(c.get("user")?.email ?? null);
    const project = c.req.query("project") || projects[0]?.entity.name || "";
    const denied = await requireProject(c, project);
    if (denied) return denied;
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
          const project = ${JSON.stringify(project).replaceAll("<", "\\u003c")};
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
    return c.html(layout("Grafo", body, c.get("user")));
  });

  return app;
}

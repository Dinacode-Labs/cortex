import { Hono } from "hono";
import { html } from "hono/html";
import { getContextPack } from "@cortex/core";
import { layout, type Html } from "../views/layout.js";
import { badge, joinHtml, statusBadge, typeBadge } from "../views/components.js";
import { requireProject } from "../middleware/access.js";
import type { WebEnv } from "../middleware/session.js";

/** Context pack de un proyecto (con vista point-in-time opcional). */
export const packRoutes = new Hono<WebEnv>();

packRoutes.get("/pack", async (c) => {
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
    // requireProject ya devolvió 404 si el proyecto no existía, pero getContextPack
    // aún lanza si el proyecto desaparece ENTRE el guard y la query (carrera) — se
    // conserva el catch para no convertir esa carrera en un 500.
    return c.html(layout("Context pack", html`<p><a class="back" href="/">← Home</a></p><div class="empty">Project not found.</div>`), 404);
  }

  const sec = (title: string, entries: typeof pack.decisions): Html =>
    entries.length
      ? html`<div class="panel"><h2>${title}</h2>${entries.map(
          (e) => html`<div style="margin-bottom:10px">${typeBadge(e.type)} ${statusBadge(e.status)}<br><b>${e.title}</b><br><span class="sub">${e.summary ?? e.content}</span></div>`,
        )}</div>`
      : html``;

  const body = html`
    <p><a class="back" href="/">← Home</a></p>
    <h1>Context Pack — ${pack.project}</h1>
    <p class="sub">${pack.totalEntries} entradas · ${asOf ? html`vigente a fecha <b>${asOfStr ?? ""}</b>` : "estado actual"} · generado ${pack.generatedAt.toISOString()}</p>
    <form class="row" method="get" action="/pack" style="margin-bottom:16px">
      <input type="hidden" name="project" value="${pack.project}">
      <input type="text" name="area" placeholder="Area or module, e.g. billing" value="${area ?? ""}">
      <input type="date" name="asof" value="${asOfStr ?? ""}" title="Point-in-time: contexto vigente a esta fecha">
      <button type="submit">Generate</button>
    </form>
    ${asOf ? html`<div class="warn">⏳ <b>Point-in-time</b> view: what was in force on ${asOfStr ?? ""} (includes what was later invalidated).</div>` : ""}
    ${sec("Decisions in force", pack.decisions)}
    ${sec("Restricciones activas", pack.constraints)}
    ${sec("Riesgos conocidos", pack.risks)}
    ${sec("Technical debt", pack.technicalDebt)}
    ${sec("Convenciones", pack.conventions)}
    ${pack.sensitiveModules.length ? html`<div class="panel"><h2>Sensitive modules</h2>${joinHtml(pack.sensitiveModules.map((m) => badge(m, "#bc4c00")), " ")}</div>` : ""}
    ${pack.relevantToArea.length ? html`<div class="panel"><h2>Most relevant to "${area ?? ""}"</h2>${pack.relevantToArea.map((h) => html`<div style="margin-bottom:8px">${badge(h.score.toFixed(2), "#0099ff")} ${h.entry.title}</div>`)}</div>` : ""}
  `;
  return c.html(layout(`Context Pack: ${pack.project}`, body, c.get("user")));
});

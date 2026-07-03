import { Hono } from "hono";
import { html } from "hono/html";
import { contextEntryType, type ContextEntryStatus } from "@cortex/shared";
import { checkEntryAccess, checkProjectAccess, getEntryDetail, saveContext, validateEntry } from "@cortex/core";
import { layout } from "../views/layout.js";
import { badge, confidenceBadge, statusBadge, typeBadge } from "../views/components.js";
import { deniedPage } from "../middleware/access.js";
import type { WebEnv } from "../middleware/session.js";

/** Entradas de contexto: detalle, validación y captura (/save). */
export const entriesRoutes = new Hono<WebEnv>();

entriesRoutes.get("/entry/:id", async (c) => {
  const id = c.req.param("id");
  // Gate por entrada (checkEntryAccess): sin acceso al proyecto de la entrada → 403.
  const access = await checkEntryAccess(c.get("user")?.email ?? null, id);
  if (access.status === "forbidden") return c.html(deniedPage(c.get("user")), 403);
  const detail = access.status === "ok" ? await getEntryDetail(id) : null;
  if (!detail) return c.html(layout("No encontrado", html`<p><a class="back" href="/">← Inicio</a></p><div class="empty">Entrada no encontrada.</div>`), 404);
  const { entry, source, entities, projectName } = detail;

  const entityTags = entities.length
    ? html`<div class="tags">${entities.map((e) => html`<a href="/search?q=${encodeURIComponent(e.name)}">#${e.name} <small>(${e.type})</small></a>`)}</div>`
    : html`<span class="sub">Sin entidades enlazadas.</span>`;

  const validateForm = (status: ContextEntryStatus, label: string) =>
    html`<form method="post" action="/entry/${entry.id}/validate" style="display:inline">
      <input type="hidden" name="status" value="${status}">
      <button class="secondary" type="submit">${label}</button>
    </form>`;

  const iso = (d: unknown) => (d instanceof Date ? d.toISOString().slice(0, 10) : String(d ?? "").slice(0, 10));
  const temporalBadge = entry.validTo
    ? badge(`no vigente desde ${iso(entry.validTo)}`, "#cf222e")
    : badge("vigente", "#1a7f37");

  const body = html`
    <p><a class="back" href="/">← Inicio</a></p>
    <div class="card-head" style="margin-bottom:8px">${typeBadge(entry.type)} ${statusBadge(entry.status)} ${confidenceBadge(entry.confidence)} ${temporalBadge}</div>
    <h1>${entry.title}</h1>

    <div class="content-block">${entry.content}</div>

    <div class="panel" style="margin-top:18px">
      <h2>Metadatos</h2>
      <dl class="meta">
        <dt>Proyecto</dt><dd>${projectName ?? "—"}</dd>
        <dt>Tipo</dt><dd>${entry.type}</dd>
        <dt>Estado</dt><dd>${statusBadge(entry.status)}</dd>
        <dt>Confianza</dt><dd>${entry.confidence}</dd>
        <dt>Fuente</dt><dd>${entry.sourceType}${entry.sourceReference ? html` · ${entry.sourceReference}` : ""}</dd>
        <dt>Autor</dt><dd>${entry.createdBy ?? "—"}</dd>
        <dt>Vigencia</dt><dd>${entry.validTo ? html`cerrada el ${iso(entry.validTo)} (${entry.validity})` : "vigente"}</dd>
        <dt>Válida desde</dt><dd>${iso(entry.validFrom)}</dd>
        <dt>Creada</dt><dd>${entry.createdAt instanceof Date ? entry.createdAt.toISOString() : entry.createdAt}</dd>
      </dl>
    </div>

    <div class="panel">
      <h2>Entidades relacionadas</h2>
      ${entityTags}
    </div>

    ${source?.rawContent ? html`<div class="panel"><h2>Fuente original</h2><div class="content-block">${source.rawContent}</div></div>` : ""}

    <div class="panel">
      <h2>Validación</h2>
      ${validateForm("validated", "✅ Validar")}
      ${validateForm("rejected", "✖ Rechazar")}
      ${validateForm("obsolete", "🗄 Marcar obsoleta")}
    </div>`;
  return c.html(layout(entry.title, body, c.get("user")));
});

entriesRoutes.post("/entry/:id/validate", async (c) => {
  const id = c.req.param("id");
  // Mismo gate que la vista de detalle (GET /entry/:id): sin acceso al proyecto de la
  // entrada no se permite cambiar su estado.
  const access = await checkEntryAccess(c.get("user")?.email ?? null, id);
  if (access.status === "not_found") return c.html(layout("No encontrado", html`<p><a class="back" href="/">← Inicio</a></p><div class="empty">Entrada no encontrada.</div>`), 404);
  if (access.status === "forbidden") return c.html(deniedPage(c.get("user")), 403);
  const form = await c.req.parseBody();
  const status = String(form.status) as "validated" | "rejected" | "obsolete";
  await validateEntry(id, status);
  return c.redirect(`/entry/${id}`);
});

// --- Guardar contexto ----------------------------------------------------------
entriesRoutes.post("/save", async (c) => {
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
  // Input de formulario validado con el enum del dominio (antes `as never`): inválido
  // o vacío se trata como ausente (clasificación automática).
  const typeParsed = contextEntryType.safeParse(String(form.type ?? "").trim());
  const type = typeParsed.success ? typeParsed.data : undefined;

  const { entry, warnings } = await saveContext({ content, project, type, createdBy: user.email });

  const warnHtml = warnings.map(
    (w) => html`<div class="warn ${w.kind === "possible_contradiction" ? "contradiction" : ""}">⚠️ ${w.message}</div>`,
  );

  const body = html`
    <p><a class="back" href="/">← Inicio</a></p>
    <h1>Guardado en Cortex</h1>
    <p class="sub">Clasificado como ${typeBadge(entry.type)} · estado ${statusBadge(entry.status)}</p>
    ${warnings.length ? warnHtml : html`<p class="sub">Sin señales del loop de mejora.</p>`}
    <p style="margin-top:16px"><a href="/entry/${entry.id}"><button>Ver entrada</button></a>
    <a href="/?capture=1"><button class="secondary">Capturar otra</button></a></p>`;
  return c.html(layout("Guardado", body, c.get("user")));
});

import { html, raw } from "hono/html";
import type { ContextEntry } from "@cortex/shared";
import type { Html } from "./layout.js";

/**
 * Los ladrillos de la interfaz.
 *
 * Todo lo que se repite en más de una pantalla vive aquí, y las rutas COMPONEN en vez de
 * escribir HTML suelto. Cuando cada página se dibujaba a sí misma, la misma idea —una tarjeta,
 * un panel, un aviso— salía distinta en cada sitio y el conjunto parecía hecho por cuatro
 * personas que no hablaban entre ellas. Un componente es también dónde arreglar algo una vez
 * (ADR-0053).
 */

/** Une fragmentos ya escapados sin volver a escaparlos. */
export function joinHtml(parts: Html[], sep = ""): Html {
  return html`${parts.flatMap((p, i) => (i === 0 ? [p] : [raw(sep), p]))}`;
}

// --- Semántica de color -------------------------------------------------------------------
//
// El color de la interfaz es casi todo tinta sobre papel; el que hay lleva significado. Estos
// tres mapas son ese significado, y por eso viven juntos: si un estado cambia de color, cambia
// aquí y en todas partes a la vez.

const STATUS_COLORS: Record<string, string> = {
  pending_validation: "#9a5b00",
  validated: "#0f7b3d",
  rejected: "#b3261e",
  superseded: "#5b6673",
  obsolete: "#5b6673",
  draft: "#5b6673",
  active: "#0f7b3d",
  archived: "#5b6673",
};

const TYPE_COLORS: Record<string, string> = {
  decision: "#1a6dff",
  constraint: "#9a5b00",
  incident: "#b3261e",
  risk: "#b3261e",
  technical_debt: "#8a4b00",
  convention: "#0f7b3d",
  architecture: "#6b3fa0",
};

/** Etiqueta de color suave: fondo al 10 % del color y el color como tinta. */
export function badge(text: string, color: string): Html {
  return html`<span class="badge" style="color:${color};background:${color}14">${text}</span>`;
}

export const statusBadge = (s: string): Html => badge(s, STATUS_COLORS[s] ?? "#5b6673");
export const typeBadge = (t: string): Html => badge(t, TYPE_COLORS[t] ?? "#5b6673");
export const confidenceBadge = (c: string): Html => badge(`conf: ${c}`, "#5b6673");
export const scoreBadge = (n: number): Html => badge(n.toFixed(2), "#1a6dff");

// --- Superficies --------------------------------------------------------------------------

export interface PanelOptions {
  /** Una línea explicando de qué va la sección. Casi siempre hace falta. */
  ayuda?: Html | string;
  /** Acciones a la derecha del título (un enlace, un botón). */
  acciones?: Html;
}

export function panel(titulo: string | null, cuerpo: Html, opts: PanelOptions = {}): Html {
  return html`<section class="panel">
    ${titulo
      ? html`<div class="row-between" style="margin-bottom:8px">
          <h2>${titulo}</h2>${opts.acciones ?? ""}
        </div>`
      : ""}
    ${opts.ayuda ? html`<p class="sub" style="margin-bottom:16px">${opts.ayuda}</p>` : ""}
    ${cuerpo}
  </section>`;
}

/**
 * Un estado vacío que dice qué hacer.
 *
 * "No hay nada" es información inútil: quien lo lee ya lo ve. Lo que necesita saber es si eso
 * está bien, y qué le toca hacer si no.
 */
export function empty(mensaje: Html | string, acciones?: Html): Html {
  return html`<div class="empty">
    <p>${mensaje}</p>
    ${acciones ? html`<div class="row" style="justify-content:center;margin-top:16px">${acciones}</div>` : ""}
  </div>`;
}

export function warn(mensaje: Html | string, tipo: "aviso" | "contradiccion" = "aviso"): Html {
  return html`<div class="warn ${tipo === "contradiccion" ? "contradiction" : ""}">${mensaje}</div>`;
}

// --- Tarjeta de entrada -------------------------------------------------------------------

export function entryCard(entry: ContextEntry): Html {
  return html`<a class="card" href="/entry/${entry.id}">
    <div class="card-head">${typeBadge(entry.type)} ${statusBadge(entry.status)} ${confidenceBadge(entry.confidence)}</div>
    <h3>${entry.title}</h3>
    <p>${entry.summary ?? entry.content}</p>
    ${entry.sourceReference ? html`<div class="src">${entry.sourceReference}</div>` : ""}
  </a>`;
}

/** Resultado de búsqueda: lo mismo con la puntuación delante, para no tener dos tarjetas. */
export function hitCard(entry: ContextEntry, score: number): Html {
  return html`<a class="card" href="/entry/${entry.id}">
    <div class="card-head">${scoreBadge(score)} ${typeBadge(entry.type)} ${statusBadge(entry.status)}</div>
    <h3>${entry.title}</h3>
    <p>${entry.summary ?? entry.content}</p>
  </a>`;
}

// --- Formularios --------------------------------------------------------------------------

/** Caja de búsqueda con su botón: aparece en cinco sitios y debe ser la misma en los cinco. */
export function searchForm(action: string, q: string, placeholder: string, ocultos: Record<string, string> = {}): Html {
  return html`<form class="row" method="get" action="${action}">
    ${Object.entries(ocultos).map(([k, v]) => html`<input type="hidden" name="${k}" value="${v}">`)}
    <input type="text" name="q" value="${q}" placeholder="${placeholder}" required>
    <button type="submit">Search</button>
  </form>`;
}

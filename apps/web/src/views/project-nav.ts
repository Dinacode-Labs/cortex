import { html } from "hono/html";
import type { ProjectRef } from "@cortex/core";
import type { ProyectoDeLaPagina } from "../middleware/access.js";
import type { Html } from "./layout.js";

/**
 * Cabecera y pestañas de un proyecto.
 *
 * Las etiquetas están escritas para quien las lee, no para el interior del sistema: **Health**
 * en vez de «Lint», **What agents see** en vez de «Context pack». Quien abre la web quiere
 * saber si su memoria está sana y qué se le está contando a su agente; «lint» y «pack» son
 * cómo lo llamamos nosotros (ADR-0050).
 */
export type Seccion = "memory" | "ask" | "agents" | "health" | "across" | "map" | "code" | "settings";

const SECCIONES: { id: Seccion; etiqueta: string; sufijo: string }[] = [
  { id: "memory", etiqueta: "Memory", sufijo: "" },
  { id: "ask", etiqueta: "Ask", sufijo: "/ask" },
  { id: "agents", etiqueta: "What agents see", sufijo: "/agents" },
  { id: "health", etiqueta: "Health", sufijo: "/health" },
  { id: "map", etiqueta: "Map", sufijo: "/map" },
  { id: "code", etiqueta: "Code", sufijo: "/code" },
];

export function visibilityPill(v: "public" | "private"): Html {
  return v === "private"
    ? html`<span class="pill vis private" title="Only its owner, its members and admins can see it">🔒 private</span>`
    : html`<span class="pill vis">public</span>`;
}

/**
 * Miga de pan hasta la raíz.
 *
 * Un hijo no se entiende solo: «Acme Portal» es un repo de un cliente, y lo que el pack le
 * cuenta a un agente viene en parte de ese cliente. Se pintan TODOS los niveles, no solo el
 * padre, porque la jerarquía no tiene por qué ser de dos. Los ancestros son siempre visibles
 * para quien ve al hijo (`canAccessProject` mira la cadena entera), así que no hay nada que
 * filtrar aquí.
 */
function crumbs(ancestros: ProjectRef[], actual: string): Html {
  if (ancestros.length === 0) return html``;
  return html`<nav class="crumbs" aria-label="Breadcrumb">
    ${ancestros.map(
      (a) => html`${a.slug ? html`<a href="/p/${a.slug}">${a.name}</a>` : html`<span>${a.name}</span>`}<span class="sep">›</span>`,
    )}<span class="here">${actual}</span>
  </nav>`;
}

/**
 * Cabecera del proyecto + pestañas.
 *
 * Toma lo que el guard ya resolvió (`requireProjectPage`) en vez de cinco argumentos sueltos:
 * quién mira, de dónde cuelga y qué cuelga de él son lo que decide qué pestañas hay. `Settings`
 * sale solo para quien gestiona, y `Across this client` solo si hay hijos que mirar — una
 * pestaña que lleva a una pantalla vacía es peor que no tenerla.
 */
export function projectHeader(pagina: ProyectoDeLaPagina, activa: Seccion): Html {
  const { project, gestor, ancestros, hijos } = pagina;
  const base = `/p/${project.slug}`;
  const tabs = [...SECCIONES];
  // Va justo después de Health, no al final: es la misma pregunta —¿me puedo fiar de esto?—
  // pero mirando al cliente entero, y leerlo seguido es como se entiende. Map y Code son otra
  // cosa, y Settings cierra siempre.
  if (hijos.length) {
    tabs.splice(tabs.findIndex((t) => t.id === "health") + 1, 0, {
      id: "across",
      etiqueta: "Across this client",
      sufijo: "/across",
    });
  }
  if (gestor) tabs.push({ id: "settings", etiqueta: "Settings", sufijo: "/settings" });
  const count = "entryCount" in project ? project.entryCount : null;
  return html`
    <div class="project-head">
      ${crumbs(ancestros, project.name)}
      <div class="project-title">
        <h1>${project.name}</h1>
        ${visibilityPill(project.visibility)}
        ${count !== null ? html`<span class="sub">${count} ${count === 1 ? "entry" : "entries"}</span>` : ""}
      </div>
      <nav class="tabs">
        ${tabs.map((t) => html`<a class="${t.id === activa ? "on" : ""}" href="${base}${t.sufijo}">${t.etiqueta}</a>`)}
      </nav>
    </div>`;
}

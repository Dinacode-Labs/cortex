import { html } from "hono/html";
import type { AccessibleProject, ProjectRef } from "@cortex/core";
import type { Html } from "./layout.js";

/**
 * Cabecera y pestañas de un proyecto.
 *
 * Las etiquetas están escritas para quien las lee, no para el interior del sistema: **Health**
 * en vez de «Lint», **What agents see** en vez de «Context pack». Quien abre la web quiere
 * saber si su memoria está sana y qué se le está contando a su agente; «lint» y «pack» son
 * cómo lo llamamos nosotros (ADR-0050).
 */
export type Seccion = "memory" | "ask" | "agents" | "health" | "map" | "code" | "settings";

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

/** Cabecera del proyecto + pestañas. `gestor` añade Settings, que el resto no necesita ver. */
export function projectHeader(
  project: ProjectRef | AccessibleProject,
  activa: Seccion,
  gestor: boolean,
): Html {
  const base = `/p/${project.slug}`;
  const tabs = [...SECCIONES, ...(gestor ? [{ id: "settings" as Seccion, etiqueta: "Settings", sufijo: "/settings" }] : [])];
  const count = "entryCount" in project ? project.entryCount : null;
  return html`
    <div class="project-head">
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

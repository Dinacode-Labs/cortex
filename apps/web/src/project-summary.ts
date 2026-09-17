import { html } from "hono/html";
import { lintProject } from "@cortex/core";
import type { Html } from "./views/layout.js";

/**
 * Estado de salud resumido de un proyecto, para no tener que entrar a ver si hay algo que
 * mirar. Acompaña siempre a la tarjeta del proyecto, y la tarjeta sale en dos sitios —la
 * portada y la lista de repos de un cliente—, así que el resumen vive fuera de las dos.
 *
 * Si el lint falla, la tarjeta se pinta sin él: no saber si está sano no es motivo para no
 * poder elegir el proyecto.
 */
export async function saludDelProyecto(nombre: string): Promise<Html> {
  try {
    const r = await lintProject(nombre);
    const avisos = r.contradictions.length + r.duplicates.length;
    if (avisos === 0) return html`<span class="health ok">✓ healthy</span>`;
    return html`<span class="health warn">${avisos} to review</span>`;
  } catch {
    return html``;
  }
}

import { raw } from "hono/html";
import type { HtmlEscapedString } from "hono/utils/html";

/** Escape HTML local: SOLO para uso interno de mdLite (el resto del render usa html``). */
function esc(s: unknown): string {
  return String(s ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

/**
 * Markdown ligero y seguro: escapa TODO el texto de entrada primero (esc) y solo
 * después añade su propio markup (negritas, listas, párrafos). Suficiente para la
 * prosa del agente LLM.
 *
 * Devuelve raw(): es seguro porque el input completo pasa por esc() ANTES de
 * insertar las etiquetas, que genera este propio código — nunca hay datos de
 * usuario sin escapar en el resultado.
 */
export function mdLite(text: string): HtmlEscapedString {
  const lines = esc(text).split(/\r?\n/);
  const out: string[] = [];
  let inList = false;
  const bold = (s: string) => s.replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>");
  for (const rawLine of lines) {
    const line = rawLine.trim();
    if (line.startsWith("- ")) {
      if (!inList) { out.push("<ul>"); inList = true; }
      out.push(`<li>${bold(line.slice(2))}</li>`);
    } else {
      if (inList) { out.push("</ul>"); inList = false; }
      if (line) out.push(`<p>${bold(line)}</p>`);
    }
  }
  if (inList) out.push("</ul>");
  return raw(out.join("\n"));
}

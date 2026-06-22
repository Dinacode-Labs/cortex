import type { ContextEntry } from "@cortex/shared";
import type { ContextPack, SaveContextResult } from "./operations.js";
import type { SearchHit } from "./vectors.js";

/** Renderizadores a Markdown para que las tools MCP devuelvan texto legible. */

function entryLine(e: ContextEntry): string {
  const ref = e.sourceReference ? ` · fuente: ${e.sourceReference}` : "";
  return `- **${e.title}** _(conf: ${e.confidence}, estado: ${e.status})_\n  ${e.summary ?? e.content}${ref}`;
}

export function renderSaveResult(result: SaveContextResult): string {
  const { entry, warnings } = result;
  const lines = [
    `✅ Guardado en Cortex como **${entry.type}** (id: \`${entry.id}\`).`,
    `Título: ${entry.title}`,
    `Estado: ${entry.status} · Confianza: ${entry.confidence}`,
  ];
  if (warnings.length > 0) {
    lines.push("", "⚠️ Señales del loop de mejora:");
    for (const w of warnings) lines.push(`- ${w.message}`);
  }
  return lines.join("\n");
}

export function renderSearchHits(hits: SearchHit[]): string {
  if (hits.length === 0) return "Sin resultados relevantes en Cortex.";
  return hits
    .map((h, i) => `${i + 1}. (${h.score.toFixed(2)}) ${entryLine(h.entry)}`)
    .join("\n");
}

export function renderDecisions(entries: ContextEntry[]): string {
  if (entries.length === 0) return "No hay decisiones registradas para este proyecto.";
  return entries.map(entryLine).join("\n");
}

export function renderContextPack(pack: ContextPack): string {
  const section = (title: string, entries: ContextEntry[]) =>
    entries.length > 0 ? `\n## ${title}\n${entries.map(entryLine).join("\n")}` : "";

  const parts = [
    `# Context Pack — ${pack.project}`,
    `_${pack.totalEntries} entradas en total · generado ${pack.generatedAt.toISOString()}_`,
    section("Decisiones técnicas vigentes", pack.decisions),
    section("Restricciones activas", pack.constraints),
    section("Riesgos conocidos", pack.risks),
    section("Deuda técnica", pack.technicalDebt),
    section("Convenciones", pack.conventions),
  ];

  if (pack.sensitiveModules.length > 0) {
    parts.push(`\n## Módulos sensibles\n${pack.sensitiveModules.map((m) => `- ${m}`).join("\n")}`);
  }
  if (pack.relevantToArea.length > 0) {
    parts.push(
      `\n## Relevante para el área consultada\n${pack.relevantToArea
        .map((h) => `- (${h.score.toFixed(2)}) ${h.entry.title} — ${h.entry.summary ?? ""}`)
        .join("\n")}`,
    );
  }
  return parts.filter(Boolean).join("\n");
}

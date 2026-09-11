import type { ContextEntry } from "@cortex/shared";
import type { ContextPack } from "./context-pack.js";
import type { SaveContextResult } from "./save.js";
import type { SearchHit } from "./vectors.js";

/**
 * Renderizadores a Markdown: es lo que devuelven las tools MCP y lo que el hook inyecta al
 * abrir sesión. Va en INGLÉS porque lo lee un modelo que puede estar trabajando en cualquier
 * idioma, y porque a menudo lo repite tal cual al usuario. El CONTENIDO de cada entrada
 * conserva el idioma en que se escribió; lo que se traduce es el andamiaje.
 */

function entryLine(e: ContextEntry): string {
  const ref = e.sourceReference ? ` · source: ${e.sourceReference}` : "";
  return `- **${e.title}** _(confidence: ${e.confidence}, status: ${e.status})_\n  ${e.summary ?? e.content}${ref}`;
}

export function renderSaveResult(result: SaveContextResult): string {
  const { entry, warnings } = result;
  const lines = [
    `✅ Saved to Cortex as **${entry.type}** (id: \`${entry.id}\`).`,
    `Title: ${entry.title}`,
    `Status: ${entry.status} · Confidence: ${entry.confidence}`,
  ];
  if (warnings.length > 0) {
    lines.push("", "⚠️ Things worth looking at:");
    for (const w of warnings) lines.push(`- ${w.message}`);
  }
  return lines.join("\n");
}

export function renderSearchHits(hits: SearchHit[]): string {
  if (hits.length === 0) return "Nothing relevant in Cortex.";
  return hits
    .map((h, i) => `${i + 1}. (${h.score.toFixed(2)}) ${entryLine(h.entry)}`)
    .join("\n");
}

export function renderDecisions(entries: ContextEntry[]): string {
  if (entries.length === 0) return "No decisions recorded for this project yet.";
  return entries.map(entryLine).join("\n");
}

export function renderContextPack(pack: ContextPack): string {
  // Aviso pegado a CADA entrada implicada, no en una sección aparte: si va al final, el
  // agente ya se ha creído la entrada cuando llega el aviso.
  const avisos = new Map<string, string>();
  for (const c of pack.conflicts ?? []) {
    const lineas: string[] = [];
    if (c.entries.length > 0) {
      const con = c.entries.map((e) => `"${e.label}" (recorded ${e.recordedLater ? "later" : "earlier"})`).join(", ");
      lineas.push(`  ⚠️ Conflicts with ${con}. Both are still recorded as current: check which one holds before relying on this.`);
    }
    for (const a of c.areas) {
      lineas.push(`  ⚠️ Touches "${a.entity}", which is recorded as contradicting ${a.against.map((x) => `"${x}"`).join(", ")}. That corner is disputed: check it before relying on this.`);
    }
    if (lineas.length > 0) avisos.set(c.entryId, lineas.join("\n"));
  }
  const linea = (e: ContextEntry): string => {
    const aviso = avisos.get(e.id);
    return aviso ? `${entryLine(e)}\n${aviso}` : entryLine(e);
  };

  const section = (title: string, entries: ContextEntry[]) =>
    entries.length > 0 ? `\n## ${title}\n${entries.map(linea).join("\n")}` : "";

  const parts = [
    `# Context Pack — ${pack.project}`,
    `_${pack.totalEntries} ${pack.totalEntries === 1 ? "entry" : "entries"} in total · generated ${pack.generatedAt.toISOString()}_`,
    section("Decisions in force", pack.decisions),
    section("Active constraints", pack.constraints),
    section("Known risks", pack.risks),
    section("Technical debt", pack.technicalDebt),
    section("Conventions", pack.conventions),
  ];

  if (pack.sensitiveModules.length > 0) {
    parts.push(`\n## Sensitive modules\n${pack.sensitiveModules.map((m) => `- ${m}`).join("\n")}`);
  }
  if (pack.relevantToArea.length > 0) {
    parts.push(
      `\n## Most relevant to the area you asked about\n${pack.relevantToArea
        .map((h) => `- (${h.score.toFixed(2)}) ${h.entry.title} — ${h.entry.summary ?? ""}`)
        .join("\n")}`,
    );
  }
  return parts.filter(Boolean).join("\n");
}

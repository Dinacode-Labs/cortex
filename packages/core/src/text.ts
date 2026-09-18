import type { ContextEntryType, EntityType } from "@cortex/shared";

/**
 * Local heuristics (no LLM) for classifying and enriching knowledge. They are a deliberately
 * simple fallback: the Mastra agents (with an LLM) are meant to improve on this in later
 * phases. Documented in docs/decisions.md (ADR-0005/6).
 *
 * The patterns below are written against the CORPUS, which is Spanish, so they keep their
 * Spanish alternatives alongside the English ones. They match what users write, not the
 * language of this file; add a language here when a corpus in that language is ingested.
 */

/** Normalises a name to its canonical form: lowercase, no accents, no extra whitespace. */
export function canonicalize(name: string): string {
  return name
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .trim()
    .replace(/\s+/g, " ");
}

/** Derives a short title when the user gave none: the first sentence, trimmed. */
export function deriveTitle(content: string): string {
  const firstLine = content.trim().split(/\r?\n/)[0] ?? content.trim();
  const firstSentence = firstLine.split(/(?<=[.!?])\s/)[0] ?? firstLine;
  const title = firstSentence.trim();
  return title.length > 120 ? `${title.slice(0, 117)}...` : title;
}

/** Heuristic summary: the first sentence(s), up to ~240 characters. */
/**
 * Strips from the summary the title that already sits right above it.
 *
 * The distiller writes content as "Title. Body..." and the summary is its first 240
 * characters, so the summary always began by repeating the title -- in one real project,
 * **355 entries out of 355**. The pack renders title and summary one under the other, and with
 * an average 47-character title above a 206-character summary that is **23% of every entry**
 * spent saying the same thing twice. Against the hook's budget that is two or three entries
 * fewer.
 *
 * Tolerant of punctuation and case because the cut is never exact; and if stripping leaves
 * nothing worthwhile, it is left as it was: repeating is ugly, having no summary is worse.
 */
export function stripLeadingTitle(summary: string, title: string): string {
  const norm = (s: string) => s.trim().toLowerCase().replace(/\s+/g, " ");
  const t = norm(title);
  if (t.length < 8) return summary; // a very short title may be a legitimate word of the text
  const s = summary.trimStart();
  if (!norm(s).startsWith(t)) return summary;
  const rest = s.slice(title.trim().length).replace(/^[\s.:;,—–-]+/, "");
  return rest.length >= 40 ? rest : summary;
}

export function summarize(content: string): string {
  const text = content.trim().replace(/\s+/g, " ");
  if (text.length <= 240) return text;
  const cut = text.slice(0, 240);
  const lastStop = Math.max(cut.lastIndexOf(". "), cut.lastIndexOf("! "), cut.lastIndexOf("? "));
  return lastStop > 80 ? cut.slice(0, lastStop + 1) : `${cut.trim()}...`;
}

// Classification rules in priority order (most specific first).
const CLASSIFY_RULES: { type: ContextEntryType; re: RegExp }[] = [
  { type: "constraint", re: /\b(restricci|no (puede|permite|admite|podemos)|exige|pol[ií]tica|prohib|requisito|debe desplegarse|constraint|no se permite)/i },
  { type: "incident", re: /\b(error|fallo|bug|incidencia|ca[ií]d|se rompe|crash|incident|defecto)/i },
  { type: "technical_debt", re: /\b(deuda t[eé]cnica|legacy|refactor|technical debt|tech debt|c[oó]digo heredado)/i },
  { type: "convention", re: /\b(convenci[oó]n|convention|est[aá]ndar|naming|estilo de c[oó]digo|coding style)/i },
  { type: "risk", re: /\b(riesgo|risk|peligro|sensible|cuidado al)/i },
  { type: "architecture", re: /\b(arquitectura|architecture|patr[oó]n|microservi|monolito|capa de)/i },
  { type: "integration_note", re: /\b(integraci[oó]n|integration|api externa|webhook|proveedor externo)/i },
  { type: "business_rule", re: /\b(regla de negocio|business rule|se factura|se calcula el|tarifa)/i },
  { type: "how_to", re: /\b(c[oó]mo (se|configurar|hacer)|how to|pasos para|gu[ií]a para)/i },
  { type: "decision", re: /\b(decid|elig|optamos|se va a|usaremos|mantener|decisi[oó]n|decision|acordamos)/i },
];

/** Heuristic classification of the entry type. Defaults to module_note. */
export function classifyType(content: string): ContextEntryType {
  for (const rule of CLASSIFY_RULES) {
    if (rule.re.test(content)) return rule.type;
  }
  return "module_note";
}

// A minimal dictionary of recognisable technologies.
const TECHNOLOGIES = [
  "laravel", "symfony", "vue", "react", "angular", "node", "nestjs", "next",
  "postgres", "postgresql", "mysql", "mariadb", "redis", "kafka", "rabbitmq",
  "docker", "kubernetes", "oauth", "jwt", "graphql", "rest", "stripe", "paypal",
  "aws", "gcp", "azure", "qdrant", "pgvector", "mastra", "mcp", "typescript",
  "php", "python", "elasticsearch", "mongodb",
];

// Common functional modules/areas worth recognising (Spanish and English spellings).
const MODULE_KEYWORDS = [
  "facturaci[oó]n", "autenticaci[oó]n", "pagos", "billing", "auth", "payments",
  "usuarios", "notificaciones", "reporting", "documentos", "checkout",
];

export interface ExtractedEntity {
  name: string;
  type: EntityType;
}

/** Extracts entities (technologies and modules) mentioned in the text. Heuristic. */
export function extractEntities(content: string): ExtractedEntity[] {
  const found = new Map<string, ExtractedEntity>();
  const lower = content.toLowerCase();

  for (const tech of TECHNOLOGIES) {
    const re = new RegExp(`\\b${tech}\\b`, "i");
    if (re.test(lower)) found.set(`technology:${tech}`, { name: tech, type: "technology" });
  }
  for (const mod of MODULE_KEYWORDS) {
    const re = new RegExp(`\\b${mod}\\b`, "i");
    const m = lower.match(re);
    if (m) found.set(`module:${m[0]}`, { name: m[0], type: "module" });
  }
  return [...found.values()];
}

/**
 * "Polarity" tags for heuristic contradiction detection (section 12.5). Two very similar
 * entries carrying opposite tags on the same axis are flagged as a possible contradiction.
 */
export function polarityTags(content: string): Set<string> {
  const tags = new Set<string>();
  const t = content.toLowerCase();
  // Axis: keep vs remove/migrate
  if (/\b(mantener|conservar|no migrar|no eliminar|seguir usando|no tocar)\b/.test(t)) tags.add("keep");
  if (/\b(eliminar|migrar|quitar|retirar|deprecar|borrar|reemplazar)\b/.test(t)) tags.add("remove");
  // Axis: on-prem vs cloud
  if (/\b(infraestructura propia|on-?prem|servidores propios)\b/.test(t)) tags.add("onprem");
  if (/\b(cloud p[uú]blico|proveedor cloud|nube p[uú]blica)\b/.test(t)) tags.add("cloud");
  return tags;
}

const OPPOSING_AXES: [string, string][] = [
  ["keep", "remove"],
  ["onprem", "cloud"],
];

/** Do the two polarity sets contradict each other on any axis? */
export function polarityContradicts(a: Set<string>, b: Set<string>): boolean {
  return OPPOSING_AXES.some(([x, y]) => (a.has(x) && b.has(y)) || (a.has(y) && b.has(x)));
}

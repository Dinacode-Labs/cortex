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

const MAX_SUMMARY_CHARS = 240;
/** Below this a summary says nothing, so whole sentences give way to a cut at a space. */
const MIN_SUMMARY_CHARS = 80;
const SENTENCE_END = /[.!?…]["')\]]?$/;

interface CleanLine {
  text: string;
  /** A line that is a block of its own in Markdown: a heading, a list item, a table row. */
  ownBlock: boolean;
  /** It opens a block: the one above it too, plus the first line after a blank one. */
  opensBlock: boolean;
}

// Only real HTML tag names, never `<[^>]+>`: a chunk of documentation that talks about
// `List<String>` would lose half the sentence.
const HTML_TAG =
  /<\/?(?:img|br|hr|p|div|span|a|em|strong|b|i|u|s|code|pre|blockquote|ul|ol|li|dl|dt|dd|table|thead|tbody|tr|td|th|h[1-6]|details|summary|figure|figcaption|picture|source|sub|sup|kbd|small|center)\b[^>]*>/gi;

function stripInline(s: string): string {
  return s
    .replace(HTML_TAG, " ")
    .replace(/!\[([^\]]*)\]\([^)]*\)/g, "$1")
    .replace(/\[([^\]]+)\]\([^)]*\)/g, "$1")
    .replace(/`([^`]+)`/g, "$1")
    .replace(/\*\*([^*]+)\*\*/g, "$1")
    .replace(/(?<!\w)__([^_]+)__(?!\w)/g, "$1")
    .replace(/(?<!\w)\*([^*\n]+)\*(?!\w)/g, "$1")
    .replace(/(?<!\w)_([^_\n]+)_(?!\w)/g, "$1")
    .replace(/~~([^~]+)~~/g, "$1");
}

function cleanLine(line: string): CleanLine | null {
  const trimmed = line.trim();
  if (!trimmed || /^(-{3,}|\*{3,}|_{3,}|={3,})$/.test(trimmed)) return null;

  const heading = /^#{1,6}\s+/.test(trimmed);
  let s = trimmed.replace(/^#{1,6}\s+/, "").replace(/^>\s?/, "");
  const listItem = /^([-*+]|\d+[.)])\s+/.test(s);
  s = s.replace(/^([-*+]|\d+[.)])\s+/, "");

  let tableRow = false;
  if (s.startsWith("|")) {
    // A separator row (|---|:--:|) is layout, not content: whatever it contributes to a
    // summary is noise.
    if (/^\|[\s:|-]+\|?$/.test(s)) return null;
    tableRow = true;
    s = s
      .replace(/^\|/, "")
      .replace(/\|$/, "")
      .split("|")
      .map((cell) => cell.trim())
      .filter(Boolean)
      .join(" · ");
  }

  s = stripInline(s).trim();
  const ownBlock = heading || listItem || tableRow;
  return s ? { text: s, ownBlock, opensBlock: ownBlock } : null;
}

/**
 * Turns a Markdown fragment into the plain prose a summary is cut out of.
 *
 * The summary of a document chunk used to be its first 240 raw characters, which in a real
 * ingestion produced entries whose whole "summary" was `…(`usedConfigurationId`) **Frontend** -`:
 * table pipes, bold markers and a backtick cut in half. The pack renders that under the title
 * and it is what the agent reads when a session opens.
 *
 * Fenced code is dropped rather than flattened -- a wall of Java in a summary teaches nobody
 * anything -- but only while something is left over, because a chunk can be nothing but code.
 *
 * Lines are joined with a full stop when the previous one was a block of its own (a heading, a
 * bullet, a table row) and did not end in one. Without it a page of headings and bullets is a
 * single 1400-character "sentence", and any cut falls in the middle of it.
 */
export function stripMarkdown(text: string): string {
  const lines = text.split(/\r?\n/);
  const joined = joinLines(lines, true);
  if (joined) return joined;
  const withCode = joinLines(lines, false);
  return withCode || text.trim().replace(/\s+/g, " ");
}

function joinLines(lines: string[], dropFencedCode: boolean): string {
  const blocks: CleanLine[] = [];
  let inFence = false;
  let afterBlank = true;
  for (const raw of lines) {
    if (/^\s*(```|~~~)/.test(raw)) {
      inFence = !inFence;
      afterBlank = true;
      continue;
    }
    if (inFence && dropFencedCode) continue;
    const cleaned = cleanLine(raw);
    if (!cleaned) {
      afterBlank = true;
      continue;
    }
    blocks.push({ ...cleaned, opensBlock: cleaned.opensBlock || afterBlank });
    afterBlank = false;
  }

  let out = "";
  for (let i = 0; i < blocks.length; i++) {
    const block = blocks[i]!;
    if (!out) {
      out = block.text;
      continue;
    }
    // Only a line that IS a block closes one: a paragraph wrapped over several lines is one
    // sentence, and a full stop per line would chop it up.
    const boundary = blocks[i - 1]!.ownBlock || block.opensBlock;
    if (boundary && !SENTENCE_END.test(out)) out = `${out.replace(/[\s,;:·—–-]+$/, "")}. `;
    else out += " ";
    out += block.text;
  }
  // Inline markers are taken out per line AND here: Markdown wraps paragraphs, so a `**bold**`
  // that opens on one line and closes on the next only matches once the lines are joined.
  return stripInline(out).replace(/\s+/g, " ").trim();
}

/** Derives a short title when the user gave none: the first sentence, trimmed. */
export function deriveTitle(content: string): string {
  const firstLine = stripMarkdown(content).split(/(?<=[.!?])\s/)[0] ?? "";
  const title = firstLine.trim();
  return title.length > 120 ? `${title.slice(0, 117)}...` : title;
}

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

function cutAtSpace(text: string, max: number): string {
  const cut = text.slice(0, max);
  const lastSpace = cut.lastIndexOf(" ");
  const kept = lastSpace > 0 ? cut.slice(0, lastSpace) : cut;
  return kept.replace(/[\s.\-–—*|_:;,·]+$/, "");
}

/**
 * Heuristic summary (no LLM): Markdown out, then whole sentences up to 240 characters.
 *
 * It never ends mid-word. When the very first sentence is longer than the budget there is no
 * sentence boundary to stop at, so it cuts at the last space and says so with an ellipsis.
 */
export function summarize(content: string): string {
  const text = stripMarkdown(content);
  if (text.length <= MAX_SUMMARY_CHARS) return text;

  let kept = "";
  for (const sentence of text.split(/(?<=[.!?…])\s+/)) {
    const next = kept ? `${kept} ${sentence}` : sentence;
    if (next.length > MAX_SUMMARY_CHARS) break;
    kept = next;
  }
  if (kept.length >= MIN_SUMMARY_CHARS) return kept;
  return `${cutAtSpace(text, MAX_SUMMARY_CHARS)}...`;
}

/**
 * Is this summary just a cut of the content, rather than something a person or a model wrote?
 *
 * It is what tells apart what may be rebuilt from what must not be touched: an explicit
 * summary from the caller, or one the LLM wrote, is knowledge in its own right. A derived one
 * always starts where the content starts -- before or after the title, with the Markdown still
 * in or already taken out, depending on which heuristic produced it.
 */
export function isDerivedSummary(summary: string | null, content: string, title: string): boolean {
  const norm = (s: string) => s.trim().replace(/\s+/g, " ");
  const s = norm(summary ?? "").replace(/\.{3}$/, "").trim();
  if (!s) return true;
  const raw = norm(content);
  const clean = norm(stripMarkdown(content));
  return [raw, norm(stripLeadingTitle(raw, title)), clean, norm(stripLeadingTitle(clean, title))].some((c) =>
    c.startsWith(s),
  );
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

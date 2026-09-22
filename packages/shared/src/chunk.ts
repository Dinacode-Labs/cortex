/**
 * Structural document chunking for RAG (ADR-0023, phase 1). Splits a long document into
 * bounded fragments while respecting natural boundaries (Markdown headings -> paragraphs ->
 * sentences), with a small overlap so an idea is not cut across two chunks. Deterministic
 * and LLM-free.
 *
 * Rationale: each document used to enter as ONE truncated entry (1 vector per doc), so a
 * long PDF lost almost everything and retrieved poorly. A long doc now yields N chunks,
 * each embedded separately and pointing back to its parent document.
 *
 * The per-chunk context prefix (Contextual Retrieval, Anthropic) is a LATER phase (it needs
 * an LLM); here there is only structure plus `section` (the heading in force) so consumers
 * can build a title/metadata and locate the fragment.
 */

export interface DocChunk {
  /** The fragment's text (including the overlap from the previous one, when it applies). */
  content: string;
  /** The Markdown heading in force at the start of the chunk, if any. */
  section: string | null;
  /** The chunk's index (0-based) within the document. */
  index: number;
  total: number;
}

export interface ChunkOptions {
  /** Target size per chunk in characters (~4 chars/token). Defaults to 4000 (~1000 tokens). */
  targetChars?: number;
  /** Hard cap per chunk. Defaults to 5000 (~1250 tokens). */
  maxChars?: number;
  /** Overlap characters copied from the end of the previous chunk. Defaults to 400. */
  overlapChars?: number;
}

const isHeading = (line: string): boolean => /^#{1,6}\s+\S/.test(line.trim());

/** Splits an oversized block (a huge paragraph) by sentences, respecting `max`.
 * A sentence still above `max` (no punctuation, e.g. a table or base64) is hard-cut. */
function splitOversized(text: string, max: number): string[] {
  const pieces = text.match(/[^.!?\n]+[.!?]*\s*|\n+/g) ?? [text];
  const out: string[] = [];
  let buf = "";
  for (let s of pieces) {
    while (s.length > max) {
      if (buf) { out.push(buf); buf = ""; }
      out.push(s.slice(0, max));
      s = s.slice(max);
    }
    if (buf && (buf + s).length > max) { out.push(buf); buf = s; }
    else buf += s;
  }
  if (buf.trim()) out.push(buf.trim());
  return out;
}

interface Unit { text: string; heading: string | null }

/**
 * Splits `raw` into structural chunks. Returns [] when the text is empty. For short
 * documents (<= target) it returns a single chunk (no overlap). Idempotent.
 */
export function chunkDocument(raw: string, opts: ChunkOptions = {}): DocChunk[] {
  const target = opts.targetChars ?? 4000;
  const max = opts.maxChars ?? 5000;
  const overlap = opts.overlapChars ?? 400;
  const text = raw.replace(/\r\n?/g, "\n").trim();
  if (!text) return [];

  // 1) Paragraphs (blank-line separated), tracking the heading in force. A paragraph
  //    whose first line is a heading updates the section.
  const paras: Unit[] = [];
  let heading: string | null = null;
  for (const block of text.split(/\n\s*\n+/)) {
    const b = block.trim();
    if (!b) continue;
    const firstLine = b.split("\n", 1)[0] ?? b;
    if (isHeading(firstLine)) heading = firstLine.replace(/^#{1,6}\s+/, "").trim().slice(0, 120);
    paras.push({ text: b, heading });
  }

  // 2) Explode paragraphs above the cap into smaller units (sentences).
  const units: Unit[] = paras.flatMap((p) =>
    p.text.length <= max ? [p] : splitOversized(p.text, max).map((t) => ({ text: t, heading: p.heading })),
  );

  // 3) Greedy packing up to `target` without going over `max`.
  const groups: Unit[] = [];
  let buf = "";
  let bufHeading: string | null = null;
  const flush = () => {
    if (buf.trim()) groups.push({ text: buf.trim(), heading: bufHeading });
    buf = "";
    bufHeading = null;
  };
  for (const u of units) {
    const joined = buf ? `${buf}\n\n${u.text}` : u.text;
    if (buf && joined.length > max) {
      flush();
      buf = u.text;
      bufHeading = u.heading;
    } else {
      if (!buf) bufHeading = u.heading;
      buf = joined;
    }
    if (buf.length >= target) flush();
  }
  flush();

  // 4) Overlap: prepend the tail of the previous chunk, trimmed to a word boundary
  //    (not on the first one). Gives continuity without net content duplication.
  const out: DocChunk[] = [];
  let prevText = "";
  groups.forEach((g, index) => {
    let content = g.text;
    if (index > 0 && overlap > 0 && prevText) {
      let tail = prevText.slice(-overlap);
      const sp = tail.indexOf(" ");
      if (sp > 0) tail = tail.slice(sp + 1);
      content = `…${tail}\n\n${g.text}`;
    }
    out.push({ content, section: g.heading, index, total: groups.length });
    prevText = g.text;
  });
  return out;
}


/**
 * Directories no connector should ever walk. Pointing a connector at a repo root without
 * this filter drags all of `vendor/` and `node_modules/` into the project's memory.
 */
export const IGNORE_DIRS = new Set([
  "node_modules", "vendor", "dist", "build", "out", "target", "coverage", ".git", ".next",
  ".nuxt", ".svelte-kit", ".venv", "venv", "__pycache__", ".pytest_cache", ".gradle",
  ".idea", ".vscode", "bin", "obj", "Pods", "DerivedData",
]);

/**
 * What it takes to get text out of a file.
 *
 * `text` only needs reading: the npm-installed CLI can do it. `heavy` needs mammoth/xlsx/unpdf,
 * or a vision or transcription model -- some 95 MB of dependencies and, in some cases, keys.
 * That lives in the server image, not on anyone's laptop (ADR-0025), so the CLI detects them,
 * counts them and says what to do with them instead of pretending they do not exist.
 */
export type ExtractionKind = "text" | "heavy" | "unsupported";

export const PLAIN_TEXT_EXTS = ["md", "markdown", "txt", "text"];
const HEAVY_EXTS = [
  "docx", "pdf", "xlsx",
  "png", "jpg", "jpeg", "webp", "gif",
  "drawio", "xml",
  "opus", "mp3", "m4a", "wav", "ogg", "oga", "flac", "aac", "amr", "weba", "mpga",
  "mp4", "mov", "mkv", "webm", "avi", "m4v", "wmv", "flv",
];

export const SUPPORTED_EXTS = new Set([...PLAIN_TEXT_EXTS, ...HEAVY_EXTS]);

export function extractionKind(fileName: string): ExtractionKind {
  const ext = fileName.slice(fileName.lastIndexOf(".") + 1).toLowerCase();
  if (PLAIN_TEXT_EXTS.includes(ext)) return "text";
  if (HEAVY_EXTS.includes(ext)) return "heavy";
  return "unsupported";
}

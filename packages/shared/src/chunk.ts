/**
 * Chunking estructural de documentos para RAG (ADR-0023, Fase 1). Trocea un documento
 * largo en fragmentos de tamaño acotado respetando fronteras naturales (headings de
 * Markdown → párrafos → frases), con un pequeño solape para no partir una idea entre dos
 * chunks. Determinista y sin LLM.
 *
 * Motivación: antes cada documento entraba como UNA entrada truncada (1 vector por doc),
 * así que un PDF largo perdía casi todo y se recuperaba mal. Ahora un doc largo produce N
 * chunks, cada uno embebido por separado y referido a su documento padre.
 *
 * El prefijo de contexto por chunk (Contextual Retrieval, Anthropic) es una fase
 * POSTERIOR (necesita LLM); aquí solo estructura + `section` (heading vigente) para que
 * los consumidores puedan construir título/metadata y ubicar el fragmento.
 */

export interface DocChunk {
  /** Texto del fragmento (con solape del anterior si aplica). */
  content: string;
  /** Heading de Markdown vigente al inicio del chunk, si lo hay. */
  section: string | null;
  /** Índice del chunk (0-based) dentro del documento. */
  index: number;
  /** Nº total de chunks del documento. */
  total: number;
}

export interface ChunkOptions {
  /** Tamaño objetivo por chunk en caracteres (~4 chars/token). Default 4000 (~1000 tokens). */
  targetChars?: number;
  /** Tope duro por chunk. Default 5000 (~1250 tokens). */
  maxChars?: number;
  /** Caracteres de solape que se copian del final del chunk anterior. Default 400. */
  overlapChars?: number;
}

const isHeading = (line: string): boolean => /^#{1,6}\s+\S/.test(line.trim());

/** Parte un bloque demasiado grande (un párrafo enorme) por frases, respetando `max`.
 * Una frase que aún supere `max` (sin puntuación, p.ej. una tabla o base64) se corta duro. */
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
 * Trocea `raw` en chunks estructurales. Devuelve [] si el texto está vacío. Para
 * documentos cortos (≤ target) devuelve un único chunk (sin solape). Idempotente.
 */
export function chunkDocument(raw: string, opts: ChunkOptions = {}): DocChunk[] {
  const target = opts.targetChars ?? 4000;
  const max = opts.maxChars ?? 5000;
  const overlap = opts.overlapChars ?? 400;
  const text = raw.replace(/\r\n?/g, "\n").trim();
  if (!text) return [];

  // 1) Párrafos (separados por línea en blanco), rastreando el heading vigente. Un
  //    párrafo cuya primera línea es un heading actualiza la sección.
  const paras: Unit[] = [];
  let heading: string | null = null;
  for (const block of text.split(/\n\s*\n+/)) {
    const b = block.trim();
    if (!b) continue;
    const firstLine = b.split("\n", 1)[0] ?? b;
    if (isHeading(firstLine)) heading = firstLine.replace(/^#{1,6}\s+/, "").trim().slice(0, 120);
    paras.push({ text: b, heading });
  }

  // 2) Explotar párrafos que superen el tope en unidades más pequeñas (frases).
  const units: Unit[] = paras.flatMap((p) =>
    p.text.length <= max ? [p] : splitOversized(p.text, max).map((t) => ({ text: t, heading: p.heading })),
  );

  // 3) Empaquetado greedy hasta `target` sin pasar de `max`.
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

  // 4) Solape: anteponer la cola del chunk previo, recortada a frontera de palabra
  //    (no en el primero). Da continuidad sin duplicar contenido de forma neta.
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
 * Directorios que ningún conector debe recorrer. Apuntar un conector a la raíz de un repo sin
 * este filtro arrastra `vendor/` y `node_modules/` enteros a la memoria del proyecto.
 */
export const IGNORE_DIRS = new Set([
  "node_modules", "vendor", "dist", "build", "out", "target", "coverage", ".git", ".next",
  ".nuxt", ".svelte-kit", ".venv", "venv", "__pycache__", ".pytest_cache", ".gradle",
  ".idea", ".vscode", "bin", "obj", "Pods", "DerivedData",
]);

/**
 * Qué hace falta para sacarle texto a un fichero.
 *
 * `texto` solo necesita leerlo: lo puede hacer el CLI que se instala con npm. `pesado` necesita
 * mammoth/xlsx/unpdf, o un modelo de visión o de transcripción — unos 95 MB de dependencias y,
 * en algunos casos, claves. Eso vive en la imagen del servidor, no en el portátil de nadie
 * (ADR-0025), así que el CLI los detecta, los cuenta y dice qué hacer con ellos en vez de
 * fingir que no existen.
 */
export type ExtractionKind = "texto" | "pesado" | "no-soportado";

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
  if (PLAIN_TEXT_EXTS.includes(ext)) return "texto";
  if (HEAVY_EXTS.includes(ext)) return "pesado";
  return "no-soportado";
}

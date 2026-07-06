import { readFileSync, statSync } from "node:fs";
import { extname } from "node:path";
import { inflateRawSync } from "node:zlib";
import mammoth from "mammoth";
import * as XLSX from "xlsx";
import { extractText, getDocumentProxy } from "unpdf";
import { getEnvNum } from "@cortex/shared";

/**
 * Capa de extracción de ficheros REUTILIZABLE por todos los conectores (la idea
 * versátil: cualquier fuente que traiga ficheros —Notion, GitHub, carpeta— los parsea
 * y RAGea). Tipos: documentos ofimáticos (determinista), diagramas .drawio (XML), e
 * **imágenes** (caption con el modelo de visión del proveedor LLM, p.ej. qwen3.6/gemma4
 * de nan). Vídeo/audio (transcripción) igual. Ver research/multimodal-ingestion.md.
 *
 * Este módulo es DETERMINISTA: la parte que necesita LLM (caption de imágenes, OCR de
 * PDF escaneado, whisper) se inyecta con setMediaExtractor() desde @cortex/agents
 * (media.ts, cableado en wireLlm) — mismo patrón que setClassifier/setReconciler. Sin
 * hook, esos formatos devuelven null, igual que antes sin API keys.
 */

const DOC_EXTS = ["docx", "pdf", "xlsx"];
const IMAGE_EXTS = ["png", "jpg", "jpeg", "webp", "gif"];
const DRAWIO_EXTS = ["drawio", "xml"];
const AUDIO_EXTS = ["opus", "mp3", "m4a", "wav", "ogg", "oga", "flac", "aac", "amr", "weba", "mpga"];
const VIDEO_EXTS = ["mp4", "mov", "mkv", "webm", "avi", "m4v", "wmv", "flv"];
export const SUPPORTED_EXTS = new Set([...DOC_EXTS, ...IMAGE_EXTS, ...DRAWIO_EXTS, ...AUDIO_EXTS, ...VIDEO_EXTS]);

// Por debajo de esto, una imagen suele ser ruido (iconos, separadores) → no se captiona.
const MIN_IMAGE_BYTES = getEnvNum("CORTEX_IMAGE_MIN_BYTES", 8000);
const OCR_MIN_TEXT = getEnvNum("CORTEX_OCR_MIN_TEXT", 120); // < esto → PDF escaneado, OCR

export interface ExtractedFile {
  text: string;
  format: string;
}

// --- Hook de extracción multimodal opcional (capa LLM) ------------------------

/** Extractor multimodal inyectable (lo provee @cortex/agents vía setMediaExtractor).
 * Cada función devuelve null si no obtiene texto útil (imagen irrelevante, sin texto,
 * herramienta externa ausente, fallo del proveedor…). */
export interface MediaExtractorHooks {
  /** Caption de una imagen (descripción indexable) o null si es decorativa. */
  captionImage?: (path: string, ext: string) => Promise<string | null>;
  /** OCR de un PDF escaneado (sin capa de texto). */
  ocrPdf?: (path: string) => Promise<string | null>;
  /** Transcripción de audio/vídeo (whisper). `kind` distingue vídeo (extraer pista de audio). */
  transcribe?: (path: string, ext: string, kind: "audio" | "video") => Promise<string | null>;
}

let mediaExtractor: MediaExtractorHooks | null = null;

/** Registra (o desregistra con null) el extractor multimodal. Lo cablean los entrypoints. */
export function setMediaExtractor(hooks: MediaExtractorHooks | null): void {
  mediaExtractor = hooks;
}

/** Extrae texto de los labels de un .drawio (XML de mxGraph; maneja diagramas comprimidos). */
function extractDrawio(path: string): string {
  const raw = readFileSync(path, "utf8");
  const values = new Set<string>();
  const collect = (xml: string) => {
    for (const m of xml.matchAll(/(?:value|label)="([^"]+)"/g)) {
      const v = m[1]!.replace(/<[^>]+>/g, " ").replace(/&[a-z]+;/g, " ").trim();
      if (v && !/^[0-9.\s]*$/.test(v)) values.add(v);
    }
  };
  collect(raw);
  if (values.size === 0) {
    // Diagrama comprimido: <diagram>base64(deflateRaw(urlencoded xml))</diagram>
    for (const m of raw.matchAll(/<diagram[^>]*>([^<]+)<\/diagram>/g)) {
      try {
        const xml = decodeURIComponent(inflateRawSync(Buffer.from(m[1]!.trim(), "base64")).toString("utf8"));
        collect(xml);
      } catch {
        /* no comprimido o ilegible */
      }
    }
  }
  return [...values].join("\n");
}

/** Extrae texto de un fichero. null si no soportado, vacío o falla. */
export async function extractFileText(path: string): Promise<ExtractedFile | null> {
  const ext = extname(path).slice(1).toLowerCase();
  try {
    if (ext === "docx") {
      const t = (await mammoth.extractRawText({ buffer: readFileSync(path) })).value;
      return clean(t, ext);
    }
    if (ext === "pdf") {
      const pdf = await getDocumentProxy(new Uint8Array(readFileSync(path)));
      const r = await extractText(pdf, { mergePages: true });
      const raw = Array.isArray(r.text) ? r.text.join("\n") : r.text;
      if (raw.trim().length >= OCR_MIN_TEXT) return clean(raw, ext);
      // Sin capa de texto (escaneado) → OCR por visión, si hay extractor inyectado
      const ocr = mediaExtractor?.ocrPdf ? await mediaExtractor.ocrPdf(path) : null;
      return ocr ? clean(ocr, "pdf-ocr") : clean(raw, ext);
    }
    if (ext === "xlsx") {
      const wb = XLSX.read(readFileSync(path), { type: "buffer" });
      return clean(wb.SheetNames.map((n) => `## ${n}\n${XLSX.utils.sheet_to_csv(wb.Sheets[n]!)}`).join("\n\n"), ext);
    }
    if (ext === "drawio" || ext === "xml") {
      return clean(extractDrawio(path), "drawio");
    }
    if (IMAGE_EXTS.includes(ext)) {
      if (statSync(path).size < MIN_IMAGE_BYTES) return null; // icono/ruido
      const caption = mediaExtractor?.captionImage ? await mediaExtractor.captionImage(path, ext) : null;
      return caption ? { text: caption, format: ext } : null;
    }
    if (AUDIO_EXTS.includes(ext) || VIDEO_EXTS.includes(ext)) {
      const kind = VIDEO_EXTS.includes(ext) ? "video" : "audio";
      const t = mediaExtractor?.transcribe ? await mediaExtractor.transcribe(path, ext, kind) : null;
      return t ? { text: t, format: ext } : null;
    }
  } catch (err) {
    // Degradamos a "no soportado" para no tumbar la ingesta, pero dejamos rastro
    // (antes un bug cualquiera se silenciaba como si el fichero no fuera soportado).
    console.warn(`[cortex] extractFileText falló para ${path}: ${err instanceof Error ? err.message : String(err)}`);
  }
  return null;
}

function clean(text: string, format: string): ExtractedFile | null {
  const t = text.replace(/[ \t]+\n/g, "\n").replace(/\n{3,}/g, "\n\n").trim();
  return t ? { text: t, format } : null;
}

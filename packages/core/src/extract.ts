import { readFileSync, statSync } from "node:fs";
import { extname } from "node:path";
import { inflateRawSync } from "node:zlib";
import mammoth from "mammoth";
import * as XLSX from "xlsx";
import { extractText, getDocumentProxy } from "unpdf";
import { getEnvNum, PLAIN_TEXT_EXTS } from "@cortex/shared";

/**
 * File extraction layer, REUSABLE by every connector (the versatile idea: any source bringing
 * files -- Notion, GitHub, a folder -- gets them parsed and RAG-ready). Kinds: plain text /
 * Markdown (read directly), office documents (deterministic), .drawio diagrams (XML), and
 * **images** (captioned with the LLM provider's vision model). Video/audio (transcription)
 * likewise. See research/multimodal-ingestion.md.
 *
 * This module is DETERMINISTIC: the part that needs an LLM (image captioning, OCR of a
 * scanned PDF, whisper) is injected with setMediaExtractor() from @cortex/agents (media.ts,
 * wired in wireLlm) -- the same pattern as setClassifier/setReconciler. With no hook, those
 * formats return null, exactly as they did before when there were no API keys.
 */

// The canonical list lives in `@cortex/shared`, because the lightweight CLI also needs to know
// what it can and cannot read (ADR-0058). Here they are only grouped to decide HOW each one is
// extracted.
const TEXT_EXTS = PLAIN_TEXT_EXTS;
const DOC_EXTS = ["docx", "pdf", "xlsx"];
const IMAGE_EXTS = ["png", "jpg", "jpeg", "webp", "gif"];
const DRAWIO_EXTS = ["drawio", "xml"];
const AUDIO_EXTS = ["opus", "mp3", "m4a", "wav", "ogg", "oga", "flac", "aac", "amr", "weba", "mpga"];
const VIDEO_EXTS = ["mp4", "mov", "mkv", "webm", "avi", "m4v", "wmv", "flv"];

// Below this, an image is usually noise (icons, separators) -> it is not captioned.
const MIN_IMAGE_BYTES = getEnvNum("CORTEX_IMAGE_MIN_BYTES", 8000);
const OCR_MIN_TEXT = getEnvNum("CORTEX_OCR_MIN_TEXT", 120); // below this -> scanned PDF, use OCR

export interface ExtractedFile {
  text: string;
  format: string;
}

/** Injectable multimodal extractor (provided by @cortex/agents through setMediaExtractor).
 * Each function returns null when it gets no useful text (irrelevant image, no text, missing
 * external tool, provider failure...). */
export interface MediaExtractorHooks {
  /** An image caption (an indexable description), or null when it is decorative. */
  captionImage?: (path: string, ext: string) => Promise<string | null>;
  /** OCR of a scanned PDF (one with no text layer). */
  ocrPdf?: (path: string) => Promise<string | null>;
  /** Audio/video transcription (whisper). `kind` marks video (the audio track is extracted). */
  transcribe?: (path: string, ext: string, kind: "audio" | "video") => Promise<string | null>;
}

let mediaExtractor: MediaExtractorHooks | null = null;

/** Registers (or, with null, unregisters) the multimodal extractor. Wired by the entrypoints. */
export function setMediaExtractor(hooks: MediaExtractorHooks | null): void {
  mediaExtractor = hooks;
}

/** Extracts text from a .drawio's labels (mxGraph XML; it handles compressed diagrams). */
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
    // Compressed diagram: <diagram>base64(deflateRaw(urlencoded xml))</diagram>
    for (const m of raw.matchAll(/<diagram[^>]*>([^<]+)<\/diagram>/g)) {
      try {
        const xml = decodeURIComponent(inflateRawSync(Buffer.from(m[1]!.trim(), "base64")).toString("utf8"));
        collect(xml);
      } catch {
        /* not compressed, or unreadable */
      }
    }
  }
  return [...values].join("\n");
}

/** Extracts text from a file. null when unsupported, empty, or on failure. */
export async function extractFileText(path: string): Promise<ExtractedFile | null> {
  const ext = extname(path).slice(1).toLowerCase();
  try {
    if (TEXT_EXTS.includes(ext)) {
      // Plain text / Markdown: read as is (it is already readable by humans and LLMs).
      return clean(readFileSync(path, "utf8"), ext);
    }
    if (ext === "docx") {
      const t = (await mammoth.extractRawText({ buffer: readFileSync(path) })).value;
      return clean(t, ext);
    }
    if (ext === "pdf") {
      const pdf = await getDocumentProxy(new Uint8Array(readFileSync(path)));
      const r = await extractText(pdf, { mergePages: true });
      const raw = Array.isArray(r.text) ? r.text.join("\n") : r.text;
      if (raw.trim().length >= OCR_MIN_TEXT) return clean(raw, ext);
      // No text layer (scanned) -> vision OCR, when an extractor has been injected
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
      if (statSync(path).size < MIN_IMAGE_BYTES) return null; // icon/noise
      const caption = mediaExtractor?.captionImage ? await mediaExtractor.captionImage(path, ext) : null;
      return caption ? { text: caption, format: ext } : null;
    }
    if (AUDIO_EXTS.includes(ext) || VIDEO_EXTS.includes(ext)) {
      const kind = VIDEO_EXTS.includes(ext) ? "video" : "audio";
      const t = mediaExtractor?.transcribe ? await mediaExtractor.transcribe(path, ext, kind) : null;
      return t ? { text: t, format: ext } : null;
    }
  } catch (err) {
    // Degrade to "unsupported" so the ingest does not go down, but leave a trace (any bug
    // used to be silenced as though the file simply were not supported).
    console.warn(`[cortex] extractFileText failed for ${path}: ${err instanceof Error ? err.message : String(err)}`);
  }
  return null;
}

function clean(text: string, format: string): ExtractedFile | null {
  const t = text.replace(/[ \t]+\n/g, "\n").replace(/\n{3,}/g, "\n\n").trim();
  return t ? { text: t, format } : null;
}

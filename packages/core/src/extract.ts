import { mkdtempSync, readFileSync, readdirSync, rmSync, statSync, unlinkSync } from "node:fs";
import { extname, join } from "node:path";
import { tmpdir } from "node:os";
import { createHash } from "node:crypto";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { inflateRawSync } from "node:zlib";
import mammoth from "mammoth";
import * as XLSX from "xlsx";
import { extractText, getDocumentProxy } from "unpdf";
import { getEnv, loadEnv } from "@cortex/shared";

const execFileAsync = promisify(execFile);

/**
 * Capa de extracción de ficheros REUTILIZABLE por todos los conectores (la idea
 * versátil: cualquier fuente que traiga ficheros —Notion, GitHub, carpeta— los parsea
 * y RAGea). Tipos: documentos ofimáticos (determinista), diagramas .drawio (XML), e
 * **imágenes** (caption con el modelo de visión del proveedor LLM, p.ej. qwen3.6/gemma4
 * de nan). Vídeo/audio (transcripción) se enchufará aquí igual. Ver
 * research/multimodal-ingestion.md.
 */

const DOC_EXTS = ["docx", "pdf", "xlsx"];
const IMAGE_EXTS = ["png", "jpg", "jpeg", "webp", "gif"];
const DRAWIO_EXTS = ["drawio", "xml"];
const AUDIO_EXTS = ["opus", "mp3", "m4a", "wav", "ogg", "oga", "flac", "aac", "amr", "weba", "mpga"];
const VIDEO_EXTS = ["mp4", "mov", "mkv", "webm", "avi", "m4v", "wmv", "flv"];
// Formatos que el endpoint whisper acepta directamente; el resto (opus de WhatsApp,
// amr, vídeo…) se transcodifican con ffmpeg a mp3 mono 16 kHz antes de transcribir.
const WHISPER_OK = new Set(["mp3", "m4a", "wav", "ogg", "oga", "flac", "mpga", "webm", "mp4", "mpeg"]);
export const SUPPORTED_DOC_EXTS = new Set(DOC_EXTS);
export const SUPPORTED_EXTS = new Set([...DOC_EXTS, ...IMAGE_EXTS, ...DRAWIO_EXTS, ...AUDIO_EXTS, ...VIDEO_EXTS]);

// Por debajo de esto, una imagen suele ser ruido (iconos, separadores) → no se captiona.
const MIN_IMAGE_BYTES = Number(process.env.CORTEX_IMAGE_MIN_BYTES ?? "8000");

export interface ExtractedFile {
  text: string;
  format: string;
}

/** Config LLM (visión) por env — mismo patrón que embeddings (provider call de una hoja). */
function visionConfig(): { key: string; base: string; model: string } | null {
  loadEnv();
  const p = getEnv("LLM_PROVIDER", "none").toLowerCase();
  if (p === "nan" && process.env.NAN_API_KEY) {
    return { key: process.env.NAN_API_KEY, base: getEnv("NAN_BASE_URL", "https://api.nan.builders/v1"), model: getEnv("NAN_LLM_MODEL", "qwen3.6") };
  }
  if (p === "openrouter" && process.env.OPENROUTER_API_KEY) {
    return { key: process.env.OPENROUTER_API_KEY, base: "https://openrouter.ai/api/v1", model: getEnv("OPENROUTER_MODEL", "deepseek/deepseek-v4-pro") };
  }
  return null;
}

interface VisionCfg {
  key: string;
  base: string;
  model: string;
}

/** Llamada de visión (imagen → texto) genérica, con reintentos en 429/5xx. */
async function visionCall(dataUrl: string, prompt: string, maxTokens: number, cfg: VisionCfg): Promise<string | null> {
  const body = JSON.stringify({
    model: cfg.model,
    max_tokens: maxTokens,
    messages: [{ role: "user", content: [{ type: "text", text: prompt }, { type: "image_url", image_url: { url: dataUrl } }] }],
  });
  const headers = { authorization: `Bearer ${cfg.key}`, "content-type": "application/json", "user-agent": "Mozilla/5.0 Dinacode-Cortex", "x-title": "Dinacode Cortex" };
  for (let attempt = 0; attempt < 4; attempt++) {
    try {
      const res = await fetch(`${cfg.base.replace(/\/$/, "")}/chat/completions`, { method: "POST", headers, body });
      if (res.ok) {
        const j = (await res.json()) as { choices?: { message?: { content?: string } }[] };
        return j.choices?.[0]?.message?.content?.trim() || null;
      }
      if (res.status !== 429 && res.status < 500) return null;
    } catch {
      /* red */
    }
    await new Promise((r) => setTimeout(r, 800 * 2 ** attempt));
  }
  return null;
}

const CAPTION_PROMPT =
  "Describe en español el contenido de esta imagen para indexarla en una memoria de proyecto software: qué muestra, textos/etiquetas/campos visibles, y si es un diagrama o captura, su propósito. Conciso (2-4 frases). Si es decorativa o un icono sin información, responde solo: IRRELEVANTE.";
const OCR_PROMPT =
  "Transcribe TODO el texto visible de esta página de documento, en orden de lectura y en su idioma original. Devuelve solo el texto (sin comentarios). Si no hay texto legible, responde solo: SIN_TEXTO.";

// Cache de captions por content-hash (durante el proceso): no llamamos al modelo de
// visión dos veces para la misma imagen (frecuente en exports con imágenes repetidas).
const captionCache = new Map<string, string | null>();

async function captionImage(path: string, ext: string): Promise<string | null> {
  const cfg = visionConfig();
  if (!cfg) return null;
  const bytes = readFileSync(path);
  const hash = createHash("sha256").update(bytes).digest("hex");
  if (captionCache.has(hash)) return captionCache.get(hash)!; // imagen ya vista → reusar
  const mime = ext === "jpg" ? "jpeg" : ext;
  const c = await visionCall(`data:image/${mime};base64,${bytes.toString("base64")}`, CAPTION_PROMPT, 240, cfg);
  const v = c && !/^IRRELEVANTE/i.test(c) ? c : null;
  captionCache.set(hash, v);
  return v;
}

/** OCR de una imagen (página renderizada) vía el modelo de visión. */
async function ocrImage(path: string, cfg: VisionCfg): Promise<string | null> {
  const t = await visionCall(`data:image/png;base64,${readFileSync(path).toString("base64")}`, OCR_PROMPT, 1500, cfg);
  return t && !/^SIN_TEXTO/i.test(t) ? t : null;
}

const MAX_OCR_PAGES = Number(process.env.CORTEX_OCR_MAX_PAGES ?? "10");
const OCR_MIN_TEXT = Number(process.env.CORTEX_OCR_MIN_TEXT ?? "120"); // < esto → PDF escaneado, OCR

/** OCR de un PDF escaneado: renderiza páginas con pdftoppm (poppler) y las pasa por visión. */
async function ocrPdf(path: string): Promise<string | null> {
  const cfg = visionConfig();
  if (!cfg) return null;
  const dir = mkdtempSync(join(tmpdir(), "cortex-ocr-"));
  try {
    await execFileAsync("pdftoppm", ["-png", "-r", "150", "-l", String(MAX_OCR_PAGES), path, join(dir, "p")], { maxBuffer: 1 << 27 });
    const pages = readdirSync(dir).filter((f) => f.endsWith(".png")).sort();
    const parts: string[] = [];
    for (const pg of pages) {
      const t = await ocrImage(join(dir, pg), cfg);
      if (t) parts.push(t);
    }
    return parts.join("\n\n").trim() || null;
  } catch {
    return null; // pdftoppm no disponible o fallo
  } finally {
    try {
      rmSync(dir, { recursive: true, force: true });
    } catch {
      /* ignore */
    }
  }
}

let tmpCounter = 0;
const MAX_AUDIO_BYTES = 24 * 1024 * 1024; // límite del endpoint whisper
const SEGMENT_SEC = Number(process.env.CORTEX_AUDIO_SEGMENT_SEC ?? "600"); // 10 min (mono 16k 64k ≈ 5 MB/chunk)

interface VisionCfg {
  key: string;
  base: string;
  model: string;
}

/** POST de un buffer de audio a whisper, con reintentos en 429/5xx. */
async function postWhisper(buf: Buffer, cfg: VisionCfg, model: string): Promise<string | null> {
  const headers = { authorization: `Bearer ${cfg.key}`, "user-agent": "Mozilla/5.0 Dinacode-Cortex", "x-title": "Dinacode Cortex" };
  for (let attempt = 0; attempt < 5; attempt++) {
    try {
      const fd = new FormData(); // se reconstruye en cada intento (el body se consume)
      fd.append("file", new Blob([buf]), "audio.mp3");
      fd.append("model", model);
      fd.append("response_format", "json");
      const res = await fetch(`${cfg.base.replace(/\/$/, "")}/audio/transcriptions`, { method: "POST", headers, body: fd });
      if (res.ok) {
        const ct = res.headers.get("content-type") ?? "";
        const text = ct.includes("json") ? ((await res.json()) as { text?: string }).text ?? "" : await res.text();
        return text.trim() || null;
      }
      if (res.status !== 429 && res.status < 500) return null;
    } catch {
      /* red */
    }
    await new Promise((r) => setTimeout(r, 1000 * 2 ** attempt));
  }
  return null;
}

/** Transcribe audio/vídeo con whisper. Vídeo y formatos no soportados (opus de WhatsApp,
 * amr…) se transcodifican con ffmpeg a mp3 mono 16 kHz. Los audios largos (> límite de
 * whisper) se TROCEAN con ffmpeg en segmentos y se transcriben por partes. */
async function transcribe(path: string, ext: string): Promise<string | null> {
  const cfg = visionConfig() as VisionCfg | null;
  if (!cfg) return null;
  const model = getEnv("NAN_WHISPER_MODEL", "whisper");
  let audioPath = path;
  let temp: string | null = null;
  if (VIDEO_EXTS.includes(ext) || !WHISPER_OK.has(ext)) {
    temp = join(tmpdir(), `cortex-audio-${process.pid}-${Date.now()}-${tmpCounter++}.mp3`);
    try {
      await execFileAsync("ffmpeg", ["-i", path, "-vn", "-ac", "1", "-ar", "16000", "-b:a", "64k", "-y", temp], { maxBuffer: 1 << 26 });
      audioPath = temp;
    } catch {
      return null; // ffmpeg no disponible o fichero ilegible
    }
  }
  let segDir: string | null = null;
  try {
    if (statSync(audioPath).size <= MAX_AUDIO_BYTES) {
      return await postWhisper(readFileSync(audioPath), cfg, model);
    }
    // Largo: trocear en segmentos mono 16 kHz mp3 y transcribir cada uno.
    segDir = mkdtempSync(join(tmpdir(), "cortex-seg-"));
    try {
      await execFileAsync(
        "ffmpeg",
        ["-i", audioPath, "-vn", "-ac", "1", "-ar", "16000", "-b:a", "64k", "-f", "segment", "-segment_time", String(SEGMENT_SEC), "-y", join(segDir, "seg%03d.mp3")],
        { maxBuffer: 1 << 26 },
      );
    } catch {
      return null;
    }
    const segs = readdirSync(segDir).filter((f) => f.endsWith(".mp3")).sort();
    const parts: string[] = [];
    for (const s of segs) {
      const t = await postWhisper(readFileSync(join(segDir, s)), cfg, model);
      if (t) parts.push(t);
    }
    return parts.join("\n").trim() || null;
  } finally {
    if (temp) {
      try {
        unlinkSync(temp);
      } catch {
        /* ignore */
      }
    }
    if (segDir) {
      try {
        rmSync(segDir, { recursive: true, force: true });
      } catch {
        /* ignore */
      }
    }
  }
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
      const ocr = await ocrPdf(path); // sin capa de texto (escaneado) → OCR por visión
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
      const caption = await captionImage(path, ext);
      return caption ? { text: caption, format: ext } : null;
    }
    if (AUDIO_EXTS.includes(ext) || VIDEO_EXTS.includes(ext)) {
      const t = await transcribe(path, ext);
      return t ? { text: t, format: ext } : null;
    }
  } catch {
    /* ignore */
  }
  return null;
}

function clean(text: string, format: string): ExtractedFile | null {
  const t = text.replace(/[ \t]+\n/g, "\n").replace(/\n{3,}/g, "\n\n").trim();
  return t ? { text: t, format } : null;
}

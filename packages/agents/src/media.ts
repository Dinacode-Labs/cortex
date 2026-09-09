import { mkdtempSync, readFileSync, readdirSync, rmSync, statSync, unlinkSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { createHash } from "node:crypto";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { getEnvNum, getSttConfig, getVisionConfig, type LlmConfig, type SttConfig, withLlmSlot } from "@cortex/shared";
import type { MediaExtractorHooks } from "@cortex/core";

const execFileAsync = promisify(execFile);

/**
 * Extractor multimodal (capa LLM): caption de imágenes y OCR de PDF escaneado con un
 * modelo de VISIÓN (getVisionConfig: mismo proveedor de chat, modelo propio vía
 * CORTEX_VISION_MODEL), y transcripción de audio/vídeo con un STT (getSttConfig:
 * endpoint PROPIO, OpenAI/whisper por defecto — OpenRouter no sirve STT). Se inyecta en
 * @cortex/core vía setMediaExtractor (cableado en wireLlm), manteniendo core determinista.
 * Ver research/multimodal-ingestion.md y ADR-0023. Cada capacidad se ofrece solo si su
 * config existe (visión y STT son independientes). */

// Formatos que el endpoint whisper acepta directamente; el resto (opus de WhatsApp,
// amr, vídeo…) se transcodifican con ffmpeg a mp3 mono 16 kHz antes de transcribir.
const WHISPER_OK = new Set(["mp3", "m4a", "wav", "ogg", "oga", "flac", "mpga", "webm", "mp4", "mpeg"]);

/** Llamada de visión (imagen → texto) genérica, con reintentos en 429/5xx. */
async function visionCall(dataUrl: string, prompt: string, maxTokens: number, cfg: LlmConfig): Promise<string | null> {
  const body = JSON.stringify({
    model: cfg.model,
    max_tokens: maxTokens,
    messages: [{ role: "user", content: [{ type: "text", text: prompt }, { type: "image_url", image_url: { url: dataUrl } }] }],
  });
  const headers = { authorization: `Bearer ${cfg.apiKey}`, "content-type": "application/json", "user-agent": "Mozilla/5.0 Dinacode-Cortex", "x-title": "Dinacode Cortex" };
  // Ocupa un slot del proveedor durante toda la llamada, reintentos incluidos: la visión
  // compite por el mismo límite de concurrencia por API key que el chat y los embeddings.
  return withLlmSlot(async () => {
    for (let attempt = 0; attempt < 4; attempt++) {
      try {
        const res = await fetch(`${cfg.baseURL.replace(/\/$/, "")}/chat/completions`, { method: "POST", headers, body });
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
  });
}

const CAPTION_PROMPT =
  "Describe en español el contenido de esta imagen para indexarla en una memoria de proyecto software: qué muestra, textos/etiquetas/campos visibles, y si es un diagrama o captura, su propósito. Conciso (2-4 frases). Si es decorativa o un icono sin información, responde solo: IRRELEVANTE.";
const OCR_PROMPT =
  "Transcribe TODO el texto visible de esta página de documento, en orden de lectura y en su idioma original. Devuelve solo el texto (sin comentarios). Si no hay texto legible, responde solo: SIN_TEXTO.";

// Cache de captions por content-hash (durante el proceso): no llamamos al modelo de
// visión dos veces para la misma imagen (frecuente en exports con imágenes repetidas).
const captionCache = new Map<string, string | null>();

async function captionImage(path: string, ext: string, cfg: LlmConfig): Promise<string | null> {
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
async function ocrImage(path: string, cfg: LlmConfig): Promise<string | null> {
  const t = await visionCall(`data:image/png;base64,${readFileSync(path).toString("base64")}`, OCR_PROMPT, 1500, cfg);
  return t && !/^SIN_TEXTO/i.test(t) ? t : null;
}

const MAX_OCR_PAGES = getEnvNum("CORTEX_OCR_MAX_PAGES", 10);

/** OCR de un PDF escaneado: renderiza páginas con pdftoppm (poppler) y las pasa por visión. */
async function ocrPdf(path: string, cfg: LlmConfig): Promise<string | null> {
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
const SEGMENT_SEC = getEnvNum("CORTEX_AUDIO_SEGMENT_SEC", 600); // 10 min (mono 16k 64k ≈ 5 MB/chunk)

/** POST de un buffer de audio a whisper, con reintentos en 429/5xx. */
async function postWhisper(buf: Buffer, cfg: SttConfig): Promise<string | null> {
  const headers = { authorization: `Bearer ${cfg.apiKey}`, "user-agent": "Mozilla/5.0 Dinacode-Cortex", "x-title": "Dinacode Cortex" };
  return withLlmSlot(async () => {
    for (let attempt = 0; attempt < 5; attempt++) {
      try {
        const fd = new FormData(); // se reconstruye en cada intento (el body se consume)
        fd.append("file", new Blob([buf]), "audio.mp3");
        fd.append("model", cfg.model);
        fd.append("response_format", "json");
        const res = await fetch(`${cfg.baseURL.replace(/\/$/, "")}/audio/transcriptions`, { method: "POST", headers, body: fd });
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
  });
}

/** Transcribe audio/vídeo con whisper. Vídeo y formatos no soportados (opus de WhatsApp,
 * amr…) se transcodifican con ffmpeg a mp3 mono 16 kHz. Los audios largos (> límite de
 * whisper) se TROCEAN con ffmpeg en segmentos y se transcriben por partes. */
async function transcribe(path: string, ext: string, kind: "audio" | "video", cfg: SttConfig): Promise<string | null> {
  let audioPath = path;
  let temp: string | null = null;
  if (kind === "video" || !WHISPER_OK.has(ext)) {
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
      return await postWhisper(readFileSync(audioPath), cfg);
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
      const t = await postWhisper(readFileSync(join(segDir, s)), cfg);
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

/** Factoría del extractor multimodal. Visión y STT son independientes: se ofrece cada
 * capacidad solo si su config existe. Null si no hay ninguna. */
export function createMediaExtractor(): MediaExtractorHooks | null {
  const vision = getVisionConfig();
  const stt = getSttConfig();
  if (!vision && !stt) return null;
  const hooks: MediaExtractorHooks = {};
  if (vision) {
    hooks.captionImage = (path, ext) => captionImage(path, ext, vision);
    hooks.ocrPdf = (path) => ocrPdf(path, vision);
  }
  if (stt) hooks.transcribe = (path, ext, kind) => transcribe(path, ext, kind, stt);
  return hooks;
}

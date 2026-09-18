import { mkdtempSync, readFileSync, readdirSync, rmSync, statSync, unlinkSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { createHash } from "node:crypto";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { getBrandName, getEnvNum, getSttConfig, getVisionConfig, type LlmConfig, type SttConfig, withLlmSlot } from "@cortex/shared";
import type { MediaExtractorHooks } from "@cortex/core";

const execFileAsync = promisify(execFile);

/**
 * Multimodal extractor (the LLM layer): image captioning and scanned-PDF OCR with a VISION
 * model (getVisionConfig: the same chat provider, its own model through CORTEX_VISION_MODEL),
 * and audio/video transcription with an STT (getSttConfig: its OWN endpoint, OpenAI/whisper by
 * default -- OpenRouter does not serve STT). It is injected into @cortex/core through
 * setMediaExtractor (wired in wireLlm), which keeps core deterministic.
 * See research/multimodal-ingestion.md and ADR-0023. Each capability is only offered when its
 * config exists (vision and STT are independent). */

// Formats the whisper endpoint accepts directly; everything else (WhatsApp opus, amr, video)
// is transcoded with ffmpeg to mono 16 kHz mp3 before transcribing.
const WHISPER_OK = new Set(["mp3", "m4a", "wav", "ogg", "oga", "flac", "mpga", "webm", "mp4", "mpeg"]);

/** A generic vision call (image -> text), with retries on 429/5xx. */
async function visionCall(dataUrl: string, prompt: string, maxTokens: number, cfg: LlmConfig): Promise<string | null> {
  const body = JSON.stringify({
    model: cfg.model,
    max_tokens: maxTokens,
    messages: [{ role: "user", content: [{ type: "text", text: prompt }, { type: "image_url", image_url: { url: dataUrl } }] }],
  });
  const headers = { authorization: `Bearer ${cfg.apiKey}`, "content-type": "application/json", "user-agent": "Mozilla/5.0 Cortex", "x-title": getBrandName() };
  // It holds a provider slot for the whole call, retries included: vision competes for the
  // same per-API-key concurrency limit as chat and embeddings.
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
        /* network */
      }
      await new Promise((r) => setTimeout(r, 800 * 2 ** attempt));
    }
    return null;
  });
}

const CAPTION_PROMPT =
  "Describe this image's content in Spanish, so it can be indexed in a software project's memory: what it shows, any visible text/labels/fields, and, if it is a diagram or a screenshot, its purpose. Be concise (2-4 sentences). If it is decorative or an icon carrying no information, answer only: IRRELEVANT.";
const OCR_PROMPT =
  "Transcribe ALL the visible text on this document page, in reading order and in its original language. Return the text only (no commentary). If there is no legible text, answer only: NO_TEXT.";

// Caption cache keyed by content hash (for the lifetime of the process): the vision model is
// never called twice for the same image (common in exports with repeated images).
const captionCache = new Map<string, string | null>();

async function captionImage(path: string, ext: string, cfg: LlmConfig): Promise<string | null> {
  const bytes = readFileSync(path);
  const hash = createHash("sha256").update(bytes).digest("hex");
  if (captionCache.has(hash)) return captionCache.get(hash)!; // imagen ya vista → reusar
  const mime = ext === "jpg" ? "jpeg" : ext;
  const c = await visionCall(`data:image/${mime};base64,${bytes.toString("base64")}`, CAPTION_PROMPT, 240, cfg);
  const v = c && !/^IRRELEVANT/i.test(c) ? c : null;
  captionCache.set(hash, v);
  return v;
}

/** OCR of an image (a rendered page) through the vision model. */
async function ocrImage(path: string, cfg: LlmConfig): Promise<string | null> {
  const t = await visionCall(`data:image/png;base64,${readFileSync(path).toString("base64")}`, OCR_PROMPT, 1500, cfg);
  return t && !/^NO_TEXT/i.test(t) ? t : null;
}

const MAX_OCR_PAGES = getEnvNum("CORTEX_OCR_MAX_PAGES", 10);

/** OCR of a scanned PDF: it renders pages with pdftoppm (poppler) and runs them through vision. */
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
    return null; // pdftoppm unavailable, or it failed
  } finally {
    try {
      rmSync(dir, { recursive: true, force: true });
    } catch {
      /* ignore */
    }
  }
}

let tmpCounter = 0;
const MAX_AUDIO_BYTES = 24 * 1024 * 1024; // the whisper endpoint's limit
const SEGMENT_SEC = getEnvNum("CORTEX_AUDIO_SEGMENT_SEC", 600); // 10 min (mono 16k 64k ≈ 5 MB/chunk)

/** POSTs an audio buffer to whisper, with retries on 429/5xx. */
async function postWhisper(buf: Buffer, cfg: SttConfig): Promise<string | null> {
  const headers = { authorization: `Bearer ${cfg.apiKey}`, "user-agent": "Mozilla/5.0 Cortex", "x-title": getBrandName() };
  return withLlmSlot(async () => {
    for (let attempt = 0; attempt < 5; attempt++) {
      try {
        const fd = new FormData(); // rebuilt on every attempt (the body gets consumed)
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
        /* network */
      }
      await new Promise((r) => setTimeout(r, 1000 * 2 ** attempt));
    }
    return null;
  });
}

/** Transcribes audio/video with whisper. Video and unsupported formats (WhatsApp opus, amr)
 * are transcoded with ffmpeg to mono 16 kHz mp3. Long audio (over whisper's limit) is SPLIT
 * with ffmpeg into segments and transcribed piece by piece. */
async function transcribe(path: string, ext: string, kind: "audio" | "video", cfg: SttConfig): Promise<string | null> {
  let audioPath = path;
  let temp: string | null = null;
  if (kind === "video" || !WHISPER_OK.has(ext)) {
    temp = join(tmpdir(), `cortex-audio-${process.pid}-${Date.now()}-${tmpCounter++}.mp3`);
    try {
      await execFileAsync("ffmpeg", ["-i", path, "-vn", "-ac", "1", "-ar", "16000", "-b:a", "64k", "-y", temp], { maxBuffer: 1 << 26 });
      audioPath = temp;
    } catch {
      return null; // ffmpeg unavailable, or an unreadable file
    }
  }
  let segDir: string | null = null;
  try {
    if (statSync(audioPath).size <= MAX_AUDIO_BYTES) {
      return await postWhisper(readFileSync(audioPath), cfg);
    }
    // Long: split into mono 16 kHz mp3 segments and transcribe each one.
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

/** Factory for the multimodal extractor. Vision and STT are independent: each capability is
 * only offered when its config exists. Null when there is neither. */
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

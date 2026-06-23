import { readFileSync, statSync } from "node:fs";
import { extname } from "node:path";
import { inflateRawSync } from "node:zlib";
import mammoth from "mammoth";
import * as XLSX from "xlsx";
import { extractText, getDocumentProxy } from "unpdf";
import { getEnv, loadEnv } from "@cortex/shared";

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
export const SUPPORTED_DOC_EXTS = new Set(DOC_EXTS);
export const SUPPORTED_EXTS = new Set([...DOC_EXTS, ...IMAGE_EXTS, ...DRAWIO_EXTS]);

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

async function captionImage(path: string, ext: string): Promise<string | null> {
  const cfg = visionConfig();
  if (!cfg) return null;
  const mime = ext === "jpg" ? "jpeg" : ext;
  const dataUrl = `data:image/${mime};base64,${readFileSync(path).toString("base64")}`;
  const body = JSON.stringify({
    model: cfg.model,
    max_tokens: 240,
    messages: [
      {
        role: "user",
        content: [
          { type: "text", text: "Describe en español el contenido de esta imagen para indexarla en una memoria de proyecto software: qué muestra, textos/etiquetas/campos visibles, y si es un diagrama o captura, su propósito. Conciso (2-4 frases). Si es decorativa o un icono sin información, responde solo: IRRELEVANTE." },
          { type: "image_url", image_url: { url: dataUrl } },
        ],
      },
    ],
  });
  const headers = { authorization: `Bearer ${cfg.key}`, "content-type": "application/json", "user-agent": "Mozilla/5.0 Dinacode-Cortex", "x-title": "Dinacode Cortex" };
  for (let attempt = 0; attempt < 4; attempt++) {
    try {
      const res = await fetch(`${cfg.base.replace(/\/$/, "")}/chat/completions`, { method: "POST", headers, body });
      if (res.ok) {
        const j = (await res.json()) as { choices?: { message?: { content?: string } }[] };
        const c = j.choices?.[0]?.message?.content?.trim() ?? "";
        return c && !/^IRRELEVANTE/i.test(c) ? c : null;
      }
      if (res.status !== 429 && res.status < 500) return null;
    } catch {
      /* red */
    }
    await new Promise((r) => setTimeout(r, 800 * 2 ** attempt));
  }
  return null;
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
      return clean(Array.isArray(r.text) ? r.text.join("\n") : r.text, ext);
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
  } catch {
    /* ignore */
  }
  return null;
}

function clean(text: string, format: string): ExtractedFile | null {
  const t = text.replace(/[ \t]+\n/g, "\n").replace(/\n{3,}/g, "\n\n").trim();
  return t ? { text: t, format } : null;
}

import { readFileSync } from "node:fs";
import { extname } from "node:path";
import mammoth from "mammoth";
import * as XLSX from "xlsx";
import { extractText, getDocumentProxy } from "unpdf";

/**
 * Capa de extracción de ficheros REUTILIZABLE por todos los conectores (la idea
 * versátil: cualquier fuente que traiga ficheros —Notion, GitHub, una carpeta— los
 * parsea y RAGea, no es una subida tonta). Aquí se enchufarán imágenes (OCR/visión) y
 * vídeo (transcripción) en el futuro; hoy: documentos ofimáticos.
 */

export const SUPPORTED_DOC_EXTS = new Set(["docx", "pdf", "xlsx"]);

export interface ExtractedFile {
  text: string;
  format: string;
}

/** Extrae texto de un fichero. Devuelve null si no está soportado, está vacío o falla
 * (p.ej. PDF escaneado sin capa de texto → OCR es roadmap). */
export async function extractFileText(path: string): Promise<ExtractedFile | null> {
  const ext = extname(path).slice(1).toLowerCase();
  if (!SUPPORTED_DOC_EXTS.has(ext)) return null;
  try {
    const buf = readFileSync(path);
    let text = "";
    if (ext === "docx") {
      text = (await mammoth.extractRawText({ buffer: buf })).value;
    } else if (ext === "pdf") {
      const pdf = await getDocumentProxy(new Uint8Array(buf));
      const r = await extractText(pdf, { mergePages: true });
      text = Array.isArray(r.text) ? r.text.join("\n") : r.text;
    } else if (ext === "xlsx") {
      const wb = XLSX.read(buf, { type: "buffer" });
      text = wb.SheetNames.map((n) => `## ${n}\n${XLSX.utils.sheet_to_csv(wb.Sheets[n]!)}`).join("\n\n");
    }
    text = text.replace(/[ \t]+\n/g, "\n").replace(/\n{3,}/g, "\n\n").trim();
    return text ? { text, format: ext } : null;
  } catch {
    return null;
  }
}

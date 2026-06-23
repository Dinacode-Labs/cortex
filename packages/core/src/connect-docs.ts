import { readFileSync, readdirSync, statSync } from "node:fs";
import { basename, extname, join, relative, resolve } from "node:path";
import mammoth from "mammoth";
import * as XLSX from "xlsx";
import { extractText, getDocumentProxy } from "unpdf";
import { closeSql, getSql } from "@cortex/database";
import { getEmbeddingProvider } from "@cortex/embeddings";
import { saveContext } from "./operations.js";
import { storeEmbeddingsBatch } from "./vectors.js";

/**
 * Conector de documentos ofimáticos (Word/PDF/Excel) → Cortex. Recorre un directorio,
 * extrae el TEXTO de cada documento (Markdown cuando se puede) y lo ingiere como entrada
 * (sourceType `document`) en 2 fases (BD → embeddings por lotes). El grafo lo añade
 * luego `maintain`/`enrich`. PDFs escaneados (sin capa de texto) se omiten — OCR es
 * roadmap (ver research/multimodal-ingestion.md).
 *
 * Uso: tsx src/connect-docs.ts "<Proyecto>" <ruta-dir>
 * Env: CORTEX_DOCS_MIN_CHARS (def 40), CORTEX_EMBED_BATCH, CORTEX_INGEST_CONCURRENCY.
 */

const EXTS = new Set(["docx", "pdf", "xlsx"]);
const MIN_CHARS = Number(process.env.CORTEX_DOCS_MIN_CHARS ?? "40");
const MAX_CONTENT = 8000;
const EMBED_BATCH = Number(process.env.CORTEX_EMBED_BATCH ?? "32");
const CONCURRENCY = Number(process.env.CORTEX_INGEST_CONCURRENCY ?? "6");
const HEX32 = /\s+[0-9a-f]{32}$/i;

interface Doc { title: string; content: string; ref: string; format: string }

function walk(dir: string): string[] {
  const out: string[] = [];
  for (const name of readdirSync(dir)) {
    if (name.startsWith(".") || name.startsWith("~$")) continue;
    const p = join(dir, name);
    const st = statSync(p);
    if (st.isDirectory()) out.push(...walk(p));
    else if (EXTS.has(extname(name).slice(1).toLowerCase())) out.push(p);
  }
  return out;
}

async function extract(file: string, ext: string): Promise<string> {
  const buf = readFileSync(file);
  if (ext === "docx") {
    const { value } = await mammoth.extractRawText({ buffer: buf });
    return value;
  }
  if (ext === "pdf") {
    const pdf = await getDocumentProxy(new Uint8Array(buf));
    const { text } = await extractText(pdf, { mergePages: true });
    return Array.isArray(text) ? text.join("\n") : text;
  }
  if (ext === "xlsx") {
    const wb = XLSX.read(buf, { type: "buffer" });
    return wb.SheetNames.map((n) => `## ${n}\n${XLSX.utils.sheet_to_csv(wb.Sheets[n]!)}`).join("\n\n");
  }
  return "";
}

function clean(s: string): string {
  return s.replace(/[ \t]+\n/g, "\n").replace(/\n{3,}/g, "\n\n").trim();
}

async function main(): Promise<void> {
  const project = process.argv[2];
  const dir = process.argv[3];
  if (!project || !dir) {
    console.error('Uso: tsx src/connect-docs.ts "<Proyecto>" <ruta-dir>');
    process.exitCode = 1;
    return;
  }
  const root = resolve(dir);
  const files = walk(root);
  console.log(`${files.length} documentos (docx/pdf/xlsx) en ${root}. Extrayendo...`);

  const docs: Doc[] = [];
  let scanned = 0;
  let errs = 0;
  for (const file of files) {
    const ext = extname(file).slice(1).toLowerCase();
    try {
      const body = clean(await extract(file, ext));
      if (body.length < MIN_CHARS) { scanned++; continue; } // vacío / PDF escaneado
      const title = basename(file, extname(file)).replace(HEX32, "").trim().slice(0, 200);
      docs.push({ title, content: `${title}\n\n${body}`.slice(0, MAX_CONTENT), ref: relative(root, file).slice(0, 200), format: ext });
    } catch (e) {
      errs++;
      console.error(`  ✗ ${basename(file)}: ${(e as Error).message}`);
    }
  }
  console.log(`${docs.length} con texto (${scanned} vacíos/escaneados omitidos, ${errs} errores). Ingestando en "${project}"...`);

  // Fase 1: persistir sin embedding.
  const toEmbed: { contextEntryId: string; text: string }[] = [];
  let cursor = 0;
  let done = 0;
  async function worker(): Promise<void> {
    while (cursor < docs.length) {
      const d = docs[cursor++]!;
      try {
        const { entry } = await saveContext(
          {
            content: d.content,
            project,
            title: d.title,
            sourceType: "document",
            sourceReference: d.ref,
            createdBy: "docs",
            metadata: { format: d.format, file: d.ref },
          },
          { useClassifier: false, detectImprovements: false, skipEmbedding: true },
        );
        toEmbed.push({ contextEntryId: entry.id, text: `${entry.title}\n\n${entry.content}` });
      } catch (e) {
        console.error(`  ✗ ${d.ref}: ${(e as Error).message}`);
      }
      if (++done % 20 === 0 || done === docs.length) console.log(`  fase 1: ${done}/${docs.length}`);
    }
  }
  await Promise.all(Array.from({ length: CONCURRENCY }, () => worker()));

  console.log(`Fase 2: embeddings por lotes de ${EMBED_BATCH}...`);
  await storeEmbeddingsBatch(getSql(), getEmbeddingProvider(), toEmbed, {
    batchSize: EMBED_BATCH,
    onProgress: (n) => console.log(`  fase 2: ${n}/${toEmbed.length}`),
  });
  console.log(`Ingesta de documentos completada: ${toEmbed.length} entradas.`);
}

main()
  .catch((e) => {
    console.error("Error en connect-docs:", e);
    process.exitCode = 1;
  })
  .finally(() => closeSql());

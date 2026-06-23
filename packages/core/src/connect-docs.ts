import { readdirSync, statSync } from "node:fs";
import { basename, extname, join, relative, resolve } from "node:path";
import { closeSql, getSql } from "@cortex/database";
import { getEmbeddingProvider } from "@cortex/embeddings";
import { saveContext } from "./operations.js";
import { storeEmbeddingsBatch } from "./vectors.js";
import { extractFileText, SUPPORTED_DOC_EXTS } from "./extract.js";

/**
 * Conector GENÉRICO de documentos: recorre un directorio suelto e ingiere los ficheros
 * ofimáticos (vía la capa `extract`). Para fuentes con estructura (Notion, etc.) usa el
 * conector específico, que enlaza cada adjunto a su página. Esto es el "subir una
 * carpeta de ficheros" sin contexto de origen.
 *
 * Uso: tsx src/connect-docs.ts "<Proyecto>" <ruta-dir>
 */

const MIN_CHARS = Number(process.env.CORTEX_DOCS_MIN_CHARS ?? "40");
const MAX_CONTENT = 8000;
const EMBED_BATCH = Number(process.env.CORTEX_EMBED_BATCH ?? "32");
const CONCURRENCY = Number(process.env.CORTEX_INGEST_CONCURRENCY ?? "6");
const HEX32 = /\s+[0-9a-f]{32}$/i;

function walk(dir: string): string[] {
  const out: string[] = [];
  for (const name of readdirSync(dir)) {
    if (name.startsWith(".") || name.startsWith("~$")) continue;
    const p = join(dir, name);
    const st = statSync(p);
    if (st.isDirectory()) out.push(...walk(p));
    else if (SUPPORTED_DOC_EXTS.has(extname(name).slice(1).toLowerCase())) out.push(p);
  }
  return out;
}

interface Doc { title: string; content: string; ref: string; format: string }

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
  console.log(`${files.length} documentos en ${root}. Extrayendo...`);

  const docs: Doc[] = [];
  let skipped = 0;
  for (const file of files) {
    const ex = await extractFileText(file);
    if (!ex || ex.text.length < MIN_CHARS) { skipped++; continue; }
    const title = basename(file, extname(file)).replace(HEX32, "").trim().slice(0, 200);
    docs.push({ title, content: `${title}\n\n${ex.text}`.slice(0, MAX_CONTENT), ref: relative(root, file).slice(0, 200), format: ex.format });
  }
  console.log(`${docs.length} con texto (${skipped} vacíos/escaneados/no soportados). Ingestando en "${project}"...`);

  const toEmbed: { contextEntryId: string; text: string }[] = [];
  let cursor = 0;
  let done = 0;
  async function worker(): Promise<void> {
    while (cursor < docs.length) {
      const d = docs[cursor++]!;
      try {
        const { entry } = await saveContext(
          { content: d.content, project, title: d.title, sourceType: "document", sourceReference: d.ref, createdBy: "docs", metadata: { format: d.format, file: d.ref } },
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

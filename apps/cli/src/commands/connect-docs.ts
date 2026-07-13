import { readdirSync, statSync } from "node:fs";
import { basename, extname, join, relative, resolve } from "node:path";
import { apiPost } from "@cortex/shared";
import { chunkDocument, extractFileText, SUPPORTED_EXTS, IGNORE_DIRS, type BatchItem } from "@cortex/core";
import { wireLlm } from "@cortex/agents";

/**
 * Conector GENÉRICO de documentos: recorre un directorio e ingiere los ficheros (vía la
 * capa `extract` multimodal). Escribe a través de la API autenticada (`POST /capture/batch`):
 * atribución (created_by=email) + permisos + embedding por lotes server-side. Requiere
 * `cortex auth login` y el servidor en marcha.
 *
 * Cada documento se **trocea** (chunkDocument, ADR-0023): un doc largo produce N chunks,
 * cada uno una entrada/vector con `sourceReference` propio (`ref#k`) y referencia a su
 * documento padre en metadata. Antes se truncaba a 8k y se perdía el resto en silencio.
 *
 * Uso: cortex connect-docs "<slug>" <ruta-dir>
 */
const MIN_CHARS = Number(process.env.CORTEX_DOCS_MIN_CHARS ?? "40");
const CHUNK = Number(process.env.CORTEX_CAPTURE_CHUNK ?? "50");
const HEX32 = /\s+[0-9a-f]{32}$/i;

/** Recorre `dir` y devuelve los ficheros con extensión soportada, SALTANDO dotfiles y
 * los directorios de dependencias/artefactos (IGNORE_DIRS: node_modules, vendor, dist…).
 * Sin ese filtro, apuntar el conector a la raíz de un repo arrastra basura de `vendor/`
 * (p.ej. fixtures de php_codesniffer) a la memoria. Exportada para test. */
export function walk(dir: string): string[] {
  const out: string[] = [];
  for (const name of readdirSync(dir)) {
    if (name.startsWith(".") || name.startsWith("~$") || IGNORE_DIRS.has(name)) continue;
    const p = join(dir, name);
    const st = statSync(p);
    if (st.isDirectory()) out.push(...walk(p));
    else if (SUPPORTED_EXTS.has(extname(name).slice(1).toLowerCase())) out.push(p);
  }
  return out;
}

export async function run(args: string[]): Promise<void> {
  wireLlm(); // extract multimodal: caption/OCR/whisper vía setMediaExtractor
  const slug = args[0];
  const dir = args[1];
  if (!slug || !dir) {
    console.error('Uso: cortex connect-docs "<slug>" <ruta-dir>');
    process.exitCode = 1;
    return;
  }
  const root = resolve(dir);
  const files = walk(root);
  console.log(`${files.length} documentos en ${root}. Extrayendo...`);

  const items: BatchItem[] = [];
  let skipped = 0;
  let docs = 0;
  for (const file of files) {
    const ex = await extractFileText(file);
    if (!ex || ex.text.length < MIN_CHARS) { skipped++; continue; }
    docs++;
    const title = basename(file, extname(file)).replace(HEX32, "").trim().slice(0, 200);
    const ref = relative(root, file).slice(0, 200);
    const chunks = chunkDocument(ex.text);
    for (const ch of chunks) {
      const multi = ch.total > 1;
      // El título lleva el doc + parte (+ sección); captureBatch lo incluye en el embedding.
      const partTitle = multi
        ? `${title} (${ch.index + 1}/${ch.total}${ch.section ? ` · ${ch.section}` : ""})`
        : title;
      items.push({
        content: ch.content,
        title: partTitle.slice(0, 200),
        sourceType: "document",
        // ref único por chunk → incremental idempotente; doc de 1 chunk conserva el ref plano.
        sourceReference: multi ? `${ref}#${ch.index}` : ref,
        metadata: {
          format: ex.format,
          file: ref,
          ...(multi ? { chunk: ch.index, chunks: ch.total } : {}),
          ...(ch.section ? { section: ch.section } : {}),
        },
      });
    }
  }
  console.log(`${docs} documentos con texto → ${items.length} chunks (${skipped} vacíos/escaneados/no soportados). Subiendo a "${slug}" vía API...`);

  let added = 0;
  let existing = 0;
  for (let i = 0; i < items.length; i += CHUNK) {
    const r = await apiPost<{ results?: { action: string }[]; error?: string }>("/capture/batch", { slug, items: items.slice(i, i + CHUNK) });
    if (!r.ok) {
      console.error(`✗ Captura fallida (${r.status}): ${r.data.error ?? "¿cortex auth login / servidor en marcha?"}`);
      process.exitCode = 1;
      return;
    }
    for (const x of r.data.results ?? []) x.action === "added" ? added++ : existing++;
    console.log(`  ${Math.min(i + CHUNK, items.length)}/${items.length}`);
  }
  console.log(`Conector docs: ${added} nuevos, ${existing} ya existían.`);
}



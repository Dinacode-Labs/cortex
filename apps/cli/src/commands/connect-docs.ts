import { readdirSync, statSync } from "node:fs";
import { basename, extname, join, relative, resolve } from "node:path";
import { apiPost } from "@cortex/shared";
import { extractFileText, SUPPORTED_EXTS, IGNORE_DIRS, type BatchItem } from "@cortex/core";
import { wireLlm } from "@cortex/agents";

/**
 * Conector GENÉRICO de documentos: recorre un directorio e ingiere los ficheros (vía la
 * capa `extract` multimodal). Escribe a través de la API autenticada (`POST /capture/batch`):
 * atribución (created_by=email) + permisos + embedding por lotes server-side. Requiere
 * `cortex auth login` y el servidor en marcha.
 *
 * Uso: cortex connect-docs "<slug>" <ruta-dir>
 */
const MIN_CHARS = Number(process.env.CORTEX_DOCS_MIN_CHARS ?? "40");
const MAX_CONTENT = 8000;
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
  for (const file of files) {
    const ex = await extractFileText(file);
    if (!ex || ex.text.length < MIN_CHARS) { skipped++; continue; }
    const title = basename(file, extname(file)).replace(HEX32, "").trim().slice(0, 200);
    const ref = relative(root, file).slice(0, 200);
    items.push({ content: `${title}\n\n${ex.text}`.slice(0, MAX_CONTENT), title, sourceType: "document", sourceReference: ref, metadata: { format: ex.format, file: ref } });
  }
  console.log(`${items.length} con texto (${skipped} vacíos/escaneados/no soportados). Subiendo a "${slug}" vía API...`);

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



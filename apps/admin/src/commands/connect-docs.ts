import { readdirSync, statSync } from "node:fs";
import { basename, extname, join, relative, resolve } from "node:path";
import { apiPost } from "@cortex/client";
import { chunkDocument, extractFileText, SUPPORTED_EXTS, IGNORE_DIRS, type BatchItem } from "@cortex/core";
import { wireLlm } from "@cortex/agents";

/**
 * The GENERIC document connector: it walks a directory and ingests the files (through the
 * multimodal `extract` layer). It writes through the authenticated API
 * (`POST /capture/batch`): attribution (created_by=email) plus permissions plus server-side
 * batch embedding. It needs `cortex auth login` and a running server.
 *
 * Each document is **chunked** (chunkDocument, ADR-0023): a long doc produces N chunks, each
 * one an entry/vector with its own `sourceReference` (`ref#k`) and a reference to its parent
 * document in metadata. It used to be truncated at 8k and the rest lost silently.
 *
 * Usage: cortex-admin connect-docs "<slug>" <dir-path>
 */
const MIN_CHARS = Number(process.env.CORTEX_DOCS_MIN_CHARS ?? "40");
const CHUNK = Number(process.env.CORTEX_CAPTURE_CHUNK ?? "50");
const HEX32 = /\s+[0-9a-f]{32}$/i;

/** Walks `dir` and returns the files with a supported extension, SKIPPING dotfiles and the
 * dependency/artefact directories (IGNORE_DIRS: node_modules, vendor, dist...). Without that
 * filter, pointing the connector at a repo root drags junk from `vendor/` (php_codesniffer
 * fixtures, for instance) into the memory. Exported for tests. */
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
  wireLlm(); // multimodal extract: caption/OCR/whisper through setMediaExtractor
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
      // The title carries the doc + part (+ section); captureBatch includes it in the embedding.
      const partTitle = multi
        ? `${title} (${ch.index + 1}/${ch.total}${ch.section ? ` · ${ch.section}` : ""})`
        : title;
      items.push({
        content: ch.content,
        title: partTitle.slice(0, 200),
        sourceType: "document",
        // A unique ref per chunk -> idempotent incremental; a 1-chunk doc keeps the flat ref.
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
  console.log(`${docs} documents with text → ${items.length} chunks (${skipped} empty/scanned/unsupported). Uploading to "${slug}" through the API...`);

  let added = 0;
  let existing = 0;
  for (let i = 0; i < items.length; i += CHUNK) {
    const r = await apiPost<{ results?: { action: string }[]; error?: string }>("/capture/batch", { slug, items: items.slice(i, i + CHUNK) });
    if (!r.ok) {
      console.error(`✗ Capture failed (${r.status}): ${r.data.error ?? "is the server running, and are you signed in (cortex auth login)?"}`);
      process.exitCode = 1;
      return;
    }
    for (const x of r.data.results ?? []) x.action === "added" ? added++ : existing++;
    console.log(`  ${Math.min(i + CHUNK, items.length)}/${items.length}`);
  }
  console.log(`Docs connector: ${added} new, ${existing} already known.`);
}



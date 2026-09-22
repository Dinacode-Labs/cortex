import { readFileSync, readdirSync, statSync } from "node:fs";
import { basename, extname, join, relative, resolve } from "node:path";
import { apiPost, useProjectServer } from "@cortex/client";
import { requireCompatibleServer } from "../compat.js";
import {
  chunkDocument,
  extractionKind,
  getBrandName,
  IGNORE_DIRS,
  type BatchItem,
} from "@cortex/shared";

/**
 * This used to live only in `cortex-admin`, which is not published to npm, so ingesting a
 * documentation directory meant cloning the whole monorepo. Ingesting documentation is one of
 * the first things somebody wants to do when they meet Cortex, and asking them for a monorepo
 * clone turned that first good idea into an installation session (ADR-0058).
 *
 * The CLI reads what it can read with no dependencies: Markdown and plain text, which is most
 * of any team's documentation and everything Notion exports. The formats that need
 * mammoth/unpdf/xlsx or a model -- docx, pdf, xlsx, images, audio, video -- are **not silently
 * ignored**: they are counted and it says what to do with them. A connector that keeps quiet
 * about what it did not upload is worse than one that does not upload it.
 *
 * It chunks exactly like the operator connector (`chunkDocument`) and writes through the
 * authenticated API, so it respects permissions and attribution. It touches neither the
 * database nor any keys.
 */

const MIN_CHARS = Number(process.env.CORTEX_DOCS_MIN_CHARS ?? "40");
const BATCH = Number(process.env.CORTEX_CAPTURE_CHUNK ?? "50");
/** Notion exports append a 32-hex hash to the filename. */
const HEX32 = /\s+[0-9a-f]{32}$/i;

interface Found {
  text: string[];
  heavy: string[];
}

export function walk(dir: string, out: Found = { text: [], heavy: [] }): Found {
  for (const name of readdirSync(dir)) {
    if (name.startsWith(".") || name.startsWith("~$") || IGNORE_DIRS.has(name)) continue;
    const p = join(dir, name);
    if (statSync(p).isDirectory()) walk(p, out);
    else if (extractionKind(name) === "text") out.text.push(p);
    else if (extractionKind(name) === "heavy") out.heavy.push(p);
  }
  return out;
}

export async function run(args: string[]): Promise<void> {
  const slug = args[0];
  const dir = args[1];
  if (!slug || !dir || slug.startsWith("-")) {
    console.error('Usage: cortex connect-docs "<slug>" <folder>');
    console.error("  Reads Markdown and plain text from the folder into the project's memory.");
    process.exitCode = 1;
    return;
  }

  const root = resolve(dir);
  let found: Found;
  try {
    found = walk(root);
  } catch (e) {
    console.error(`Could not read ${root}: ${(e as Error).message}`);
    process.exitCode = 1;
    return;
  }

  // The server comes from the `.cortex.json` of the folder the command is launched from
  // (ADR-0033), not from the documents folder, which may live anywhere.
  useProjectServer(process.cwd());
  await requireCompatibleServer();

  if (found.text.length === 0 && found.heavy.length === 0) {
    console.error(`Nothing readable in ${root}.`);
    process.exitCode = 1;
    return;
  }

  const items: BatchItem[] = [];
  let docs = 0;
  let empty = 0;
  for (const file of found.text) {
    let text: string;
    try {
      text = readFileSync(file, "utf8");
    } catch {
      empty++;
      continue;
    }
    if (text.trim().length < MIN_CHARS) {
      empty++;
      continue;
    }
    docs++;
    const title = basename(file, extname(file)).replace(HEX32, "").trim().slice(0, 200);
    const ref = relative(root, file).slice(0, 200);
    for (const ch of chunkDocument(text)) {
      const many = ch.total > 1;
      const partTitle = many
        ? `${title} (${ch.index + 1}/${ch.total}${ch.section ? ` · ${ch.section}` : ""})`
        : title;
      items.push({
        content: ch.content,
        title: partTitle.slice(0, 200),
        sourceType: "document",
        // A unique ref per fragment -> re-running is incremental, it does not duplicate.
        sourceReference: many ? `${ref}#${ch.index}` : ref,
        metadata: {
          format: extname(file).slice(1).toLowerCase(),
          file: ref,
          ...(many ? { chunk: ch.index, chunks: ch.total } : {}),
          ...(ch.section ? { section: ch.section } : {}),
        },
      });
    }
  }

  console.log(
    `${docs} document${docs === 1 ? "" : "s"} → ${items.length} chunk${items.length === 1 ? "" : "s"}` +
      `${empty ? ` (${empty} too short)` : ""}. Sending to "${slug}"…`,
  );

  let added = 0;
  let known = 0;
  for (let i = 0; i < items.length; i += BATCH) {
    const r = await apiPost<{ results?: { action: string }[]; error?: string }>("/capture/batch", {
      slug,
      items: items.slice(i, i + BATCH),
    });
    if (!r.ok) {
      console.error(
        `Capture failed (${r.status}): ${r.data.error ?? `is the project "${slug}" linked, and are you signed in?`}`,
      );
      process.exitCode = 1;
      return;
    }
    for (const x of r.data.results ?? []) x.action === "added" ? added++ : known++;
    process.stdout.write(`  ${Math.min(i + BATCH, items.length)}/${items.length}\r`);
  }
  if (items.length) console.log(`\n${added} new, ${known} already known.`);

  if (found.heavy.length > 0) {
    const byType = new Map<string, number>();
    for (const f of found.heavy) {
      const ext = extname(f).slice(1).toLowerCase();
      byType.set(ext, (byType.get(ext) ?? 0) + 1);
    }
    const summary = [...byType.entries()].sort((a, b) => b[1] - a[1]).map(([e, n]) => `${n} .${e}`).join(", ");
    console.log(
      `\n${found.heavy.length} file${found.heavy.length === 1 ? "" : "s"} left out (${summary}).\n` +
        `Reading those needs document and media extraction, which ${getBrandName()} keeps on the server side\n` +
        `rather than in the CLI. An operator can ingest them with:  cortex-admin connect-docs "${slug}" ${dir}`,
    );
  }
}

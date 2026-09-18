import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { basename, extname, join, resolve } from "node:path";
import { getEnvNum } from "@cortex/shared";
import { apiPost } from "@cortex/client";
import { extractFileText, SUPPORTED_EXTS, type BatchItem } from "@cortex/core";
import { wireLlm } from "@cortex/agents";

/**
 * The Notion export connector (Markdown + ATTACHMENTS), **content aware**: it ingests the page
 * (notion_doc) and parses/RAGs its attachments (through the multimodal `extract` layer),
 * linking them to the page (`belongs_to`). It writes through Cortex's authenticated API
 * (`POST /capture/batch` + `/relate`): attribution (created_by=email) plus permissions plus
 * server-side batch embedding. Incremental by sourceReference.
 *
 * Usage: cortex-admin connect-notion "<slug>" <export-path>
 * It needs `cortex auth login` and a running server. Env: CORTEX_DRY=1.
 */
// It shares the ingestion concurrency lever with `cortex-admin ingest` (same env var, same
// default of 8). The connector uploads through the authenticated API; to be more conservative
// with Notion, lower CORTEX_INGEST_CONCURRENCY in the environment.
const PHASE1_CONCURRENCY = getEnvNum("CORTEX_INGEST_CONCURRENCY", 8);
const CHUNK = Number(process.env.CORTEX_CAPTURE_CHUNK ?? "50");
const MIN_BODY = Number(process.env.CORTEX_NOTION_MIN_BODY ?? "40");
const MAX_CONTENT = 8000;
const HEX32 = /\b[0-9a-f]{32}\b/;

interface ParsedPage { title: string; notionId?: string; status?: string; content: string; bodyLen: number; ref: string }

function attachmentDir(file: string): string | null {
  const candidates = [file.replace(/\s+[0-9a-f]{32}\.md$/i, ""), file.slice(0, -3)];
  for (const c of candidates) {
    try {
      if (existsSync(c) && statSync(c).isDirectory()) return c;
    } catch {
      /* ignore */
    }
  }
  return null;
}

function walkMd(dir: string): string[] {
  const out: string[] = [];
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    const st = statSync(p);
    if (st.isDirectory()) out.push(...walkMd(p));
    else if (name.toLowerCase().endsWith(".md")) out.push(p);
  }
  return out;
}

// Notion's own property names, as they appear in the exports being ingested. They stay in the
// language of the workspace they came from: these are data, not our text. Add the ones your
// workspace uses.
const PROP_KEYS =
  "Status|Revisado|Created time|Last edited time|Last edited by|ID|Parent item|Sub-item|Priority|Responsable|Labels|Secci[oó]n|Fecha|Fecha limite|ORDEN RESOLUCI[OÓ]N|Review in|Resumen Estado|REPORTADO POR USUARIO|Tasks|Owner|Assignee";
const PROP_LINE = new RegExp(`^(?:${PROP_KEYS}):\\s*.*$`, "gim");

function cleanBody(raw: string): string {
  return raw
    .replace(/!\[[^\]]*\]\([^)]*\)/g, "")
    .replace(/\[([^\]]+)\]\([^)]*\)/g, "$1")
    .replace(PROP_LINE, "")
    .replace(/\([^()]*%[0-9a-f]{2}[^()]*\)/gi, "")
    .replace(/\([^()]*\.(?:md|csv|drawio|png|jpe?g|pdf|docx?|xlsx?|mp4)\)/gi, "")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function parsePage(file: string): ParsedPage {
  const raw = readFileSync(file, "utf8");
  const lines = raw.split("\n");
  const titleLine = lines.find((l) => l.startsWith("# "));
  const title = (titleLine ? titleLine.slice(2) : basename(file).replace(/\s+[0-9a-f]{32}\.md$/i, "")).trim();
  const meta: Record<string, string> = {};
  for (const l of lines.slice(0, 14)) {
    const m = l.match(/^([A-Za-zÁÉÍÓÚñÑ ]+):\s*(.+)$/);
    if (m && m[1] && m[2]) meta[m[1].trim().toLowerCase()] = m[2].trim();
  }
  const bodyStart = titleLine ? lines.indexOf(titleLine) + 1 : 0;
  const body = cleanBody(lines.slice(bodyStart).join("\n"));
  const status = meta["status"];
  const header = status ? `Estado: ${status}` : "";
  const content = [title, header, body].filter(Boolean).join("\n\n").slice(0, MAX_CONTENT);
  const ref = (basename(file).match(HEX32)?.[0] ?? meta["id"] ?? basename(file)).slice(0, 64);
  return { title: title.slice(0, 200), notionId: meta["id"], status, content, bodyLen: body.length, ref };
}

type AttItem = BatchItem & { parentRef: string };
interface BatchResult { ref: string | null; id: string; action: string }

async function postBatch(slug: string, items: BatchItem[]): Promise<BatchResult[]> {
  const r = await apiPost<{ results?: BatchResult[]; error?: string }>("/capture/batch", { slug, items });
  if (!r.ok) {
    console.error(`✗ Capture failed (${r.status}): ${r.data.error ?? "is the server running, and are you signed in (cortex auth login)?"}`);
    process.exit(1);
  }
  return r.data.results ?? [];
}

export async function run(args: string[]): Promise<void> {
  wireLlm(); // multimodal extract: caption/OCR/whisper through setMediaExtractor
  const slug = args[0];
  const dir = args[1];
  if (!slug || !dir) {
    console.error('Usage: cortex-admin connect-notion "<slug>" <export-path>');
    process.exitCode = 1;
    return;
  }
  const files = walkMd(resolve(dir));
  console.log(`Found ${files.length} .md pages. Extracting for "${slug}"...`);

  if (process.env.CORTEX_DRY === "1") {
    for (const f of files.slice(0, 4)) {
      const p = parsePage(f);
      const folder = attachmentDir(f);
      const att = folder ? readdirSync(folder).filter((n) => SUPPORTED_EXTS.has(extname(n).slice(1).toLowerCase())) : [];
      console.log(`\n--- ${p.title} [ref=${p.ref} body=${p.bodyLen}] attachments: ${att.join(", ") || "-"}`);
    }
    return;
  }

  // Phase 1 (local): parse pages + extract attachments (concurrency capped by the VLM/whisper).
  const pageItems: BatchItem[] = [];
  const attItems: AttItem[] = [];
  let cursor = 0;
  let failed = 0;
  async function worker(): Promise<void> {
    while (cursor < files.length) {
      const file = files[cursor++]!;
      const pg = parsePage(file);
      try {
        const folder = attachmentDir(file);
        const myAtts: AttItem[] = [];
        if (folder) {
          for (const name of readdirSync(folder)) {
            if (!SUPPORTED_EXTS.has(extname(name).slice(1).toLowerCase())) continue;
            const ex = await extractFileText(join(folder, name));
            if (!ex || ex.text.length < MIN_BODY) continue;
            const title = name.replace(/\.[^.]+$/, "").replace(/\s+[0-9a-f]{32}$/i, "").slice(0, 200);
            myAtts.push({
              content: `${title}\n\n${ex.text}`.slice(0, MAX_CONTENT),
              title,
              sourceType: "document",
              sourceReference: `${pg.ref}/${name}`.slice(0, 180),
              parentRef: pg.ref,
              metadata: { format: ex.format, parentPage: pg.title, parentRef: pg.ref },
            });
          }
        }
        // The page: with a body, or a stub when it only has attachments (to hang them off).
        if (pg.bodyLen >= MIN_BODY) {
          pageItems.push({ content: pg.content, title: pg.title, sourceType: "notion_doc", sourceReference: pg.ref, metadata: { notionId: pg.notionId, status: pg.status } });
        } else if (myAtts.length) {
          pageItems.push({ content: pg.title, title: pg.title, sourceType: "notion_doc", sourceReference: pg.ref, metadata: { notionId: pg.notionId } });
        }
        attItems.push(...myAtts);
      } catch (e) {
        failed++;
        console.error(`  ✗ ${pg.ref}: ${(e as Error).message}`);
      }
    }
  }
  await Promise.all(Array.from({ length: PHASE1_CONCURRENCY }, () => worker()));
  console.log(`Extracted: ${pageItems.length} pages, ${attItems.length} attachments (${failed} failed). Uploading through the API...`);

  // Phase 2: upload the pages (ref -> id), then the attachments, then link them.
  const pageId = new Map<string, string>();
  for (let i = 0; i < pageItems.length; i += CHUNK) {
    for (const x of await postBatch(slug, pageItems.slice(i, i + CHUNK))) if (x.ref) pageId.set(x.ref, x.id);
  }
  const toRelate: { attId: string; parentRef: string }[] = [];
  for (let i = 0; i < attItems.length; i += CHUNK) {
    const slice = attItems.slice(i, i + CHUNK);
    const results = await postBatch(slug, slice.map(({ parentRef, ...rest }) => rest));
    results.forEach((res, j) => { if (res.action === "added") toRelate.push({ attId: res.id, parentRef: slice[j]!.parentRef }); });
  }
  let related = 0;
  for (const { attId, parentRef } of toRelate) {
    const pid = pageId.get(parentRef);
    if (!pid) continue;
    const rr = await apiPost("/relate", { sourceId: attId, targetId: pid, relationType: "belongs_to" });
    if (rr.ok) related++;
  }
  console.log(`Notion: ${pageId.size} pages, ${toRelate.length} new attachments (${related} linked to their page).`);
}



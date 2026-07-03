import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { basename, extname, join, resolve } from "node:path";
import { apiPost } from "@cortex/shared";
import { extractFileText, SUPPORTED_EXTS, type BatchItem } from "@cortex/core";

/**
 * Conector de export de Notion (Markdown + ADJUNTOS), **consciente del contenido**:
 * ingiere la página (notion_doc) y parsea/RAGea sus adjuntos (vía la capa `extract`
 * multimodal), enlazándolos a la página (`belongs_to`). Escribe a través de la API
 * autenticada de Cortex (`POST /capture/batch` + `/relate`): atribución (created_by=email)
 * + permisos + embedding por lotes server-side. Incremental por sourceReference.
 *
 * Uso: cortex connect-notion "<slug>" <ruta-export>
 * Requiere `cortex auth login` y el servidor en marcha. Env: CORTEX_DRY=1.
 */
const PHASE1_CONCURRENCY = Number(process.env.CORTEX_INGEST_CONCURRENCY ?? "4");
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
    console.error(`✗ Captura fallida (${r.status}): ${r.data.error ?? "¿cortex auth login / servidor en marcha?"}`);
    process.exit(1);
  }
  return r.data.results ?? [];
}

export async function run(args: string[]): Promise<void> {
  const slug = args[0];
  const dir = args[1];
  if (!slug || !dir) {
    console.error('Uso: cortex connect-notion "<slug>" <ruta-export>');
    process.exitCode = 1;
    return;
  }
  const files = walkMd(resolve(dir));
  console.log(`Encontradas ${files.length} páginas .md. Extrayendo para "${slug}"...`);

  if (process.env.CORTEX_DRY === "1") {
    for (const f of files.slice(0, 4)) {
      const p = parsePage(f);
      const folder = attachmentDir(f);
      const att = folder ? readdirSync(folder).filter((n) => SUPPORTED_EXTS.has(extname(n).slice(1).toLowerCase())) : [];
      console.log(`\n--- ${p.title} [ref=${p.ref} body=${p.bodyLen}] adjuntos: ${att.join(", ") || "-"}`);
    }
    return;
  }

  // Fase 1 (local): parsea páginas + extrae adjuntos (concurrencia limitada por el VLM/whisper).
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
        // Página: con cuerpo, o stub si solo tiene adjuntos (para colgarlos).
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
  console.log(`Extraído: ${pageItems.length} páginas, ${attItems.length} adjuntos (${failed} fallos). Subiendo vía API...`);

  // Fase 2: subir páginas (ref→id), luego adjuntos, luego enlazar.
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
  console.log(`Notion: ${pageId.size} páginas, ${toRelate.length} adjuntos nuevos (${related} enlazados a su página).`);
}



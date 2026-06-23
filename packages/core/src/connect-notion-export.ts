import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { basename, extname, join, resolve } from "node:path";
import { closeSql, getSql } from "@cortex/database";
import { getEmbeddingProvider } from "@cortex/embeddings";
import { saveContext } from "./operations.js";
import { relate } from "./entities.js";
import { storeEmbeddingsBatch } from "./vectors.js";
import { extractFileText, SUPPORTED_DOC_EXTS } from "./extract.js";
import type { Row } from "./map.js";

/**
 * Conector de export de Notion (Markdown + ADJUNTOS). Notion exporta cada página como
 * `<Título> <id32hex>.md` y sus ficheros adjuntos en la carpeta hermana
 * `<Título> <id32hex>/`. Este conector es **consciente del contenido**: ingiere la
 * página (sourceType notion_doc) y **parsea + RAGea sus adjuntos** (docx/pdf/xlsx vía
 * la capa `extract`), creándolos como entradas `document` **enlazadas a la página**
 * (`belongs_to`). Idempotente/incremental (salta lo ya ingerido por sourceReference).
 *
 * Uso: tsx src/connect-notion-export.ts "<Proyecto>" <ruta-export>
 * Env: CORTEX_INGEST_LLM=1; CORTEX_EMBED_BATCH; CORTEX_DRY=1.
 */

const USE_LLM = process.env.CORTEX_INGEST_LLM === "1";
const PHASE1_CONCURRENCY = Number(process.env.CORTEX_INGEST_CONCURRENCY ?? "8");
const EMBED_BATCH = Number(process.env.CORTEX_EMBED_BATCH ?? "32");
const MIN_BODY = Number(process.env.CORTEX_NOTION_MIN_BODY ?? "40");
const MAX_CONTENT = 8000;
const HEX32 = /\b[0-9a-f]{32}\b/;

interface ParsedPage { title: string; notionId?: string; status?: string; content: string; bodyLen: number; ref: string }

/** Carpeta de adjuntos de una página. Notion la nombra como el título (a veces SIN el
 * hash del fichero .md). Probamos ambas formas y devolvemos la que exista. */
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

async function existingId(sql: ReturnType<typeof getSql>, project: string, ref: string): Promise<string | null> {
  const rows = (await sql`
    SELECT ce.id FROM context_entries ce JOIN entities p ON p.id = ce.project_id
    WHERE p.name = ${project} AND ce.source_reference = ${ref} LIMIT 1
  `) as unknown as Row[];
  return (rows[0]?.id as string) ?? null;
}

async function main(): Promise<void> {
  const project = process.argv[2];
  const dir = process.argv[3];
  if (!project || !dir) {
    console.error('Uso: tsx src/connect-notion-export.ts "<Proyecto>" <ruta-export>');
    process.exitCode = 1;
    return;
  }
  const proj = project; // narrowed a string (uso dentro del closure worker)
  const sql = getSql();
  const files = walkMd(resolve(dir));
  console.log(`Encontradas ${files.length} páginas .md. Ingestando en "${project}" (llm=${USE_LLM})...`);

  if (process.env.CORTEX_DRY === "1") {
    for (const f of files.slice(0, 4)) {
      const p = parsePage(f);
      const folder = attachmentDir(f);
      const att = folder ? readdirSync(folder).filter((n) => SUPPORTED_DOC_EXTS.has(extname(n).slice(1).toLowerCase())) : [];
      console.log(`\n--- ${p.title} [ref=${p.ref} body=${p.bodyLen}] adjuntos: ${att.join(", ") || "-"}`);
    }
    return;
  }

  const toEmbed: { contextEntryId: string; text: string }[] = [];
  let cursor = 0;
  let pagesNew = 0;
  let pagesSkip = 0;
  let attNew = 0;
  let failed = 0;

  async function worker(): Promise<void> {
    while (cursor < files.length) {
      const file = files[cursor++]!;
      const pg = parsePage(file);
      try {
        // 1) Página (si tiene cuerpo). Incremental por ref.
        let pageId = await existingId(sql, proj, pg.ref);
        if (!pageId && pg.bodyLen >= MIN_BODY) {
          const { entry } = await saveContext(
            { content: pg.content, project: proj, title: pg.title, sourceType: "notion_doc", sourceReference: pg.ref, createdBy: "notion", metadata: { notionId: pg.notionId, status: pg.status } },
            { useClassifier: USE_LLM, detectImprovements: false, skipEmbedding: true },
          );
          pageId = entry.id;
          toEmbed.push({ contextEntryId: entry.id, text: `${entry.title}\n\n${entry.content}` });
          pagesNew++;
        } else if (pageId) {
          pagesSkip++;
        }

        // 2) Adjuntos de la página (carpeta hermana). Parseados + enlazados a la página.
        const folder = attachmentDir(file);
        if (folder) {
          for (const name of readdirSync(folder)) {
            if (!SUPPORTED_DOC_EXTS.has(extname(name).slice(1).toLowerCase())) continue;
            const aref = `${pg.ref}/${name}`.slice(0, 180);
            if (await existingId(sql, proj, aref)) continue; // ya ingerido
            const ex = await extractFileText(join(folder, name));
            if (!ex || ex.text.length < MIN_BODY) continue;
            // Si la página no tenía cuerpo, creamos un stub para colgar los adjuntos.
            if (!pageId) {
              const stub = await saveContext(
                { content: pg.title, project: proj, title: pg.title, sourceType: "notion_doc", sourceReference: pg.ref, createdBy: "notion", metadata: { notionId: pg.notionId } },
                { useClassifier: false, detectImprovements: false, skipEmbedding: true },
              );
              pageId = stub.entry.id;
            }
            const title = name.replace(/\.[^.]+$/, "").replace(/\s+[0-9a-f]{32}$/i, "").slice(0, 200);
            const { entry } = await saveContext(
              { content: `${title}\n\n${ex.text}`.slice(0, MAX_CONTENT), project: proj, title, sourceType: "document", sourceReference: aref, createdBy: "notion", metadata: { format: ex.format, parentPage: pg.title, parentRef: pg.ref } },
              { useClassifier: false, detectImprovements: false, skipEmbedding: true },
            );
            await relate(sql, { sourceId: entry.id, sourceType: "context_entry", targetId: pageId, targetType: "context_entry", relationType: "belongs_to" });
            toEmbed.push({ contextEntryId: entry.id, text: `${title}\n\n${ex.text}` });
            attNew++;
          }
        }
      } catch (e) {
        failed++;
        console.error(`  ✗ ${pg.ref}: ${(e as Error).message}`);
      }
    }
  }
  await Promise.all(Array.from({ length: PHASE1_CONCURRENCY }, () => worker()));
  console.log(`Fase 1: ${pagesNew} páginas nuevas, ${pagesSkip} ya existían, ${attNew} adjuntos parseados+enlazados (${failed} fallos).`);

  console.log(`Fase 2: embeddings por lotes de ${EMBED_BATCH}...`);
  await storeEmbeddingsBatch(getSql(), getEmbeddingProvider(), toEmbed, {
    batchSize: EMBED_BATCH,
    onProgress: (d) => console.log(`  fase 2: ${d}/${toEmbed.length}`),
  });
  console.log("Ingesta de Notion (páginas + adjuntos) completada.");
}

main()
  .catch((e) => {
    console.error("Error en connect-notion-export:", e);
    process.exitCode = 1;
  })
  .finally(() => closeSql());

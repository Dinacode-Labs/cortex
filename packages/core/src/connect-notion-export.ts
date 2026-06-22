import { readFileSync, readdirSync, statSync } from "node:fs";
import { basename, join, resolve } from "node:path";
import { closeSql, getSql } from "@cortex/database";
import { getEmbeddingProvider } from "@cortex/embeddings";
import { saveContext } from "./operations.js";
import { storeEmbeddingsBatch } from "./vectors.js";

/**
 * Conector de export de Notion (Markdown & CSV). Notion exporta cada página como un
 * `.md` ("<Título> <id32hex>.md") con metadatos inline (Status, ID, Revisado…) y
 * cuerpo. Este conector recorre las páginas, limpia el Markdown (imágenes/links de
 * assets) y las ingiere como entradas (sourceType notion_doc) en 2 fases (BD →
 * embeddings por lotes), igual que `ingest`.
 *
 * Uso: tsx src/connect-notion-export.ts "<Proyecto>" <ruta-export>
 * Env: CORTEX_INGEST_LLM=1 para clasificar con LLM; CORTEX_EMBED_BATCH, etc.
 */

const USE_LLM = process.env.CORTEX_INGEST_LLM === "1";
const PHASE1_CONCURRENCY = Number(process.env.CORTEX_INGEST_CONCURRENCY ?? "8");
const EMBED_BATCH = Number(process.env.CORTEX_EMBED_BATCH ?? "32");
const MIN_BODY = Number(process.env.CORTEX_NOTION_MIN_BODY ?? "40");
const MAX_CONTENT = 6000;

const HEX32 = /\b[0-9a-f]{32}\b/;

interface Page {
  title: string;
  notionId?: string;
  status?: string;
  content: string;
  ref: string;
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

// Claves de propiedad de Notion (se quitan del cuerpo; el contenido real va aparte).
const PROP_KEYS =
  "Status|Revisado|Created time|Last edited time|Last edited by|ID|Parent item|Sub-item|Priority|Responsable|Labels|Secci[oó]n|Fecha|Fecha limite|ORDEN RESOLUCI[OÓ]N|Review in|Resumen Estado|REPORTADO POR USUARIO|Tasks|Owner|Assignee";
const PROP_LINE = new RegExp(`^(?:${PROP_KEYS}):\\s*.*$`, "gim");

function cleanBody(raw: string): string {
  return raw
    .replace(/!\[[^\]]*\]\([^)]*\)/g, "") // imágenes embebidas
    .replace(/\[([^\]]+)\]\([^)]*\)/g, "$1") // links markdown → solo texto
    .replace(PROP_LINE, "") // líneas de propiedades de Notion
    .replace(/\([^()]*%[0-9a-f]{2}[^()]*\)/gi, "") // parens con URLs codificadas (assets)
    .replace(/\([^()]*\.(?:md|csv|drawio|png|jpe?g|pdf|docx?|xlsx?|mp4)\)/gi, "") // parens con ficheros
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function parsePage(file: string): Page | null {
  const raw = readFileSync(file, "utf8");
  const lines = raw.split("\n");
  const titleLine = lines.find((l) => l.startsWith("# "));
  const title = (titleLine ? titleLine.slice(2) : basename(file).replace(/\s+[0-9a-f]{32}\.md$/i, "")).trim();

  // Metadatos inline tipo "Status: X", "ID: 123", "Revisado: No".
  const meta: Record<string, string> = {};
  for (const l of lines.slice(0, 14)) {
    const m = l.match(/^([A-Za-zÁÉÍÓÚñÑ ]+):\s*(.+)$/);
    if (m && m[1] && m[2]) meta[m[1].trim().toLowerCase()] = m[2].trim();
  }

  // Cuerpo = todo menos el título; se limpian propiedades y assets.
  const bodyStart = titleLine ? lines.indexOf(titleLine) + 1 : 0;
  const body = cleanBody(lines.slice(bodyStart).join("\n"));
  if (body.length < MIN_BODY) return null; // páginas casi vacías (solo imágenes)

  const status = meta["status"];
  const header = status ? `Estado: ${status}` : "";
  const content = [title, header, body].filter(Boolean).join("\n\n").slice(0, MAX_CONTENT);
  const ref = (basename(file).match(HEX32)?.[0] ?? meta["id"] ?? basename(file)).slice(0, 64);

  return { title: title.slice(0, 200), notionId: meta["id"], status, content, ref };
}

async function main(): Promise<void> {
  const project = process.argv[2];
  const dir = process.argv[3];
  if (!project || !dir) {
    console.error('Uso: tsx src/connect-notion-export.ts "<Proyecto>" <ruta-export>');
    process.exitCode = 1;
    return;
  }

  const files = walkMd(resolve(dir));
  console.log(`Encontradas ${files.length} páginas .md en el export.`);
  const pages = files.map(parsePage).filter((p): p is Page => p !== null);
  console.log(`${pages.length} con contenido (>${MIN_BODY} chars).`);

  if (process.env.CORTEX_DRY === "1") {
    for (const pg of pages.slice(0, 4)) {
      console.log(`\n--- ${pg.title}  [status=${pg.status ?? "-"} id=${pg.notionId ?? "-"} ref=${pg.ref}]`);
      console.log(pg.content.slice(0, 280).replace(/\n+/g, " ") + "…");
    }
    return;
  }
  console.log(`Ingestando en "${project}" (llm=${USE_LLM})...`);

  // Fase 1: persistir sin embedding.
  const toEmbed: { contextEntryId: string; text: string }[] = [];
  let cursor = 0;
  let done = 0;
  let failed = 0;
  async function worker(): Promise<void> {
    while (cursor < pages.length) {
      const pg = pages[cursor++]!;
      try {
        const { entry } = await saveContext(
          {
            content: pg.content,
            project,
            title: pg.title,
            sourceType: "notion_doc",
            sourceReference: pg.ref,
            createdBy: "notion",
            metadata: { notionId: pg.notionId, status: pg.status },
          },
          { useClassifier: USE_LLM, detectImprovements: false, skipEmbedding: true },
        );
        toEmbed.push({ contextEntryId: entry.id, text: `${entry.title}\n\n${entry.content}` });
      } catch (e) {
        failed++;
        console.error(`  ✗ ${pg.ref}: ${(e as Error).message}`);
      }
      if (++done % 50 === 0 || done === pages.length) console.log(`  fase 1: ${done}/${pages.length}`);
    }
  }
  await Promise.all(Array.from({ length: PHASE1_CONCURRENCY }, () => worker()));
  console.log(`Fase 1 ok: ${toEmbed.length} entradas (${failed} fallos).`);

  console.log(`Fase 2: embeddings por lotes de ${EMBED_BATCH}...`);
  await storeEmbeddingsBatch(getSql(), getEmbeddingProvider(), toEmbed, {
    batchSize: EMBED_BATCH,
    onProgress: (d) => console.log(`  fase 2: ${d}/${toEmbed.length}`),
  });
  console.log("Ingesta de Notion completada.");
}

main()
  .catch((e) => {
    console.error("Error en connect-notion-export:", e);
    process.exitCode = 1;
  })
  .finally(() => closeSql());

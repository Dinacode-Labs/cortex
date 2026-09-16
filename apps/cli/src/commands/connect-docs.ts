import { readFileSync, readdirSync, statSync } from "node:fs";
import { basename, extname, join, relative, resolve } from "node:path";
import { apiPost, useProjectServer } from "@cortex/client";
import {
  chunkDocument,
  extractionKind,
  getBrandName,
  IGNORE_DIRS,
  type BatchItem,
} from "@cortex/shared";

/**
 * `cortex connect-docs` — mete la documentación de una carpeta en la memoria del proyecto.
 *
 * Esto vivía solo en `cortex-admin`, que no se publica en npm, así que para ingerir un
 * directorio de documentación había que clonar el monorepo entero. Ingerir documentación es de
 * las primeras cosas que alguien quiere hacer al conocer Cortex, y pedirle un clon del
 * monorepo para eso convertía la primera buena idea en un rato de instalación (ADR-0058).
 *
 * El CLI lee lo que puede leer sin dependencias: Markdown y texto plano, que es la mayor parte
 * de la documentación de cualquier equipo y todo lo que exporta Notion. Los formatos que
 * necesitan mammoth/unpdf/xlsx o un modelo —docx, pdf, xlsx, imágenes, audio, vídeo— **no se
 * ignoran en silencio**: se cuentan y se dice qué hacer con ellos. Un conector que se calla lo
 * que no ha subido es peor que uno que no lo sube.
 *
 * Trocea igual que el conector de operador (`chunkDocument`) y escribe por la API autenticada,
 * así que respeta permisos y atribución. No toca la base de datos ni necesita claves.
 *
 * Uso: cortex connect-docs "<slug>" <carpeta>
 */

const MIN_CHARS = Number(process.env.CORTEX_DOCS_MIN_CHARS ?? "40");
const LOTE = Number(process.env.CORTEX_CAPTURE_CHUNK ?? "50");
/** Los exports de Notion cuelgan un hash de 32 hex del nombre del fichero. */
const HEX32 = /\s+[0-9a-f]{32}$/i;

interface Hallazgo {
  texto: string[];
  pesados: string[];
}

/** Recorre la carpeta separando lo que este CLI puede leer de lo que no. */
export function recorre(dir: string, out: Hallazgo = { texto: [], pesados: [] }): Hallazgo {
  for (const name of readdirSync(dir)) {
    if (name.startsWith(".") || name.startsWith("~$") || IGNORE_DIRS.has(name)) continue;
    const p = join(dir, name);
    if (statSync(p).isDirectory()) recorre(p, out);
    else if (extractionKind(name) === "texto") out.texto.push(p);
    else if (extractionKind(name) === "pesado") out.pesados.push(p);
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
  let hallazgo: Hallazgo;
  try {
    hallazgo = recorre(root);
  } catch (e) {
    console.error(`Could not read ${root}: ${(e as Error).message}`);
    process.exitCode = 1;
    return;
  }

  // El servidor sale del `.cortex.json` de la carpeta desde la que se lanza (ADR-0033), no de
  // la carpeta de documentos, que puede estar en cualquier sitio.
  useProjectServer(process.cwd());

  if (hallazgo.texto.length === 0 && hallazgo.pesados.length === 0) {
    console.error(`Nothing readable in ${root}.`);
    process.exitCode = 1;
    return;
  }

  const items: BatchItem[] = [];
  let docs = 0;
  let vacios = 0;
  for (const file of hallazgo.texto) {
    let text: string;
    try {
      text = readFileSync(file, "utf8");
    } catch {
      vacios++;
      continue;
    }
    if (text.trim().length < MIN_CHARS) {
      vacios++;
      continue;
    }
    docs++;
    const title = basename(file, extname(file)).replace(HEX32, "").trim().slice(0, 200);
    const ref = relative(root, file).slice(0, 200);
    for (const ch of chunkDocument(text)) {
      const varios = ch.total > 1;
      const parteTitulo = varios
        ? `${title} (${ch.index + 1}/${ch.total}${ch.section ? ` · ${ch.section}` : ""})`
        : title;
      items.push({
        content: ch.content,
        title: parteTitulo.slice(0, 200),
        sourceType: "document",
        // Ref única por fragmento → volver a lanzarlo es incremental, no duplica.
        sourceReference: varios ? `${ref}#${ch.index}` : ref,
        metadata: {
          format: extname(file).slice(1).toLowerCase(),
          file: ref,
          ...(varios ? { chunk: ch.index, chunks: ch.total } : {}),
          ...(ch.section ? { section: ch.section } : {}),
        },
      });
    }
  }

  console.log(
    `${docs} document${docs === 1 ? "" : "s"} → ${items.length} chunk${items.length === 1 ? "" : "s"}` +
      `${vacios ? ` (${vacios} too short)` : ""}. Sending to "${slug}"…`,
  );

  let nuevos = 0;
  let existentes = 0;
  for (let i = 0; i < items.length; i += LOTE) {
    const r = await apiPost<{ results?: { action: string }[]; error?: string }>("/capture/batch", {
      slug,
      items: items.slice(i, i + LOTE),
    });
    if (!r.ok) {
      console.error(
        `Capture failed (${r.status}): ${r.data.error ?? `is the project "${slug}" linked, and are you signed in?`}`,
      );
      process.exitCode = 1;
      return;
    }
    for (const x of r.data.results ?? []) x.action === "added" ? nuevos++ : existentes++;
    process.stdout.write(`  ${Math.min(i + LOTE, items.length)}/${items.length}\r`);
  }
  if (items.length) console.log(`\n${nuevos} new, ${existentes} already known.`);

  // Lo que este CLI no sabe leer se dice, con su número y con la salida.
  if (hallazgo.pesados.length > 0) {
    const porTipo = new Map<string, number>();
    for (const f of hallazgo.pesados) {
      const ext = extname(f).slice(1).toLowerCase();
      porTipo.set(ext, (porTipo.get(ext) ?? 0) + 1);
    }
    const resumen = [...porTipo.entries()].sort((a, b) => b[1] - a[1]).map(([e, n]) => `${n} .${e}`).join(", ");
    console.log(
      `\n${hallazgo.pesados.length} file${hallazgo.pesados.length === 1 ? "" : "s"} left out (${resumen}).\n` +
        `Reading those needs document and media extraction, which ${getBrandName()} keeps on the server side\n` +
        `rather than in the CLI. An operator can ingest them with:  cortex-admin connect-docs "${slug}" ${dir}`,
    );
  }
}

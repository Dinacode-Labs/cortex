import { existsSync, readdirSync, statSync } from "node:fs";
import { basename, extname, join, resolve } from "node:path";
import { loadEnv } from "@cortex/shared";
loadEnv();
import { closeSql } from "@cortex/database";
import { extractFileText } from "@cortex/core";
import { captureCondensedViaApi } from "./connect-sessions.js";
import { shutdownObservability } from "./mastra.js";

/**
 * Conector de REUNIONES: transcribe grabaciones (audio/vídeo, vía `extract`) y, en vez de
 * guardar el transcript en crudo, lo **destila** a conocimiento tipado (decisiones,
 * incidencias, acuerdos…) reutilizando el pipeline de captura (distiller + reconciliación
 * + API autenticada → atribución/permisos). Una reunión de 1h → unas pocas entradas útiles.
 *
 * Uso: tsx src/connect-meeting.ts "<slug>" <fichero|carpeta>
 * Requiere `cortex auth login`, el servidor en marcha y ffmpeg (para A/V).
 */
const AV = new Set(["opus", "mp3", "m4a", "wav", "ogg", "oga", "flac", "aac", "amr", "weba", "mpga", "mp4", "mov", "mkv", "webm", "avi", "m4v", "wmv", "flv"]);

function walk(p: string): string[] {
  if (!statSync(p).isDirectory()) return AV.has(extname(p).slice(1).toLowerCase()) ? [p] : [];
  const out: string[] = [];
  for (const n of readdirSync(p)) out.push(...walk(join(p, n)));
  return out;
}

async function main(): Promise<void> {
  const slug = process.argv[2];
  const path = process.argv[3];
  if (!slug || !path) {
    console.error('Uso: tsx src/connect-meeting.ts "<slug>" <fichero-audio/vídeo|carpeta>');
    process.exitCode = 1;
    return;
  }
  if (!existsSync(path)) {
    console.error(`No existe: ${path}`);
    process.exitCode = 1;
    return;
  }
  const files = walk(resolve(path));
  console.log(`${files.length} grabación(es). Transcribiendo + destilando → "${slug}" (vía API)...`);

  let saved = 0;
  let updated = 0;
  let superseded = 0;
  let failed = 0;
  for (const file of files) {
    const ex = await extractFileText(file); // transcribe (whisper + ffmpeg, con chunking)
    if (!ex || ex.text.length < 200) {
      console.log(`  ${basename(file)}: sin transcripción útil`);
      continue;
    }
    const r = await captureCondensedViaApi(slug, ex.text, basename(file), "meeting", "meeting_transcript");
    saved += r.saved;
    updated += r.updated;
    superseded += r.superseded;
    failed += r.failed;
    console.log(`  ${basename(file)}: +${r.saved} nuevas, ~${r.updated} fusionadas, ⊘${r.superseded} superadas${r.failed ? `, ${r.failed} fallos` : ""}`);
  }
  console.log(`Reuniones: +${saved} nuevas, ~${updated} UPDATE, ⊘${superseded} SUPERSEDE${failed ? `, ${failed} fallos (¿cortex auth login / servidor?)` : ""}.`);
}

main()
  .catch((e) => {
    console.error("Error en connect-meeting:", e);
    process.exitCode = 1;
  })
  .finally(async () => {
    await shutdownObservability();
    await closeSql();
    process.exit(process.exitCode ?? 0);
  });

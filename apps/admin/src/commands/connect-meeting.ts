import { existsSync, readdirSync, statSync } from "node:fs";
import { basename, extname, join, resolve } from "node:path";
import { extractFileText } from "@cortex/core";
import { sendCondensedSession } from "@cortex/client";
import { shutdownObservability, wireLlm } from "@cortex/agents";

/**
 * Conector de REUNIONES: transcribe grabaciones (audio/vídeo, vía `extract`) y, en vez de
 * guardar el transcript en crudo, lo **destila** a conocimiento tipado (decisiones,
 * incidencias, acuerdos…) reutilizando el pipeline de captura (distiller + reconciliación
 * + API autenticada → atribución/permisos). Una reunión de 1h → unas pocas entradas útiles.
 *
 * Uso: cortex connect-meeting "<slug>" <fichero|carpeta>
 * Requiere `cortex auth login`, el servidor en marcha y ffmpeg (para A/V).
 */
const AV = new Set(["opus", "mp3", "m4a", "wav", "ogg", "oga", "flac", "aac", "amr", "weba", "mpga", "mp4", "mov", "mkv", "webm", "avi", "m4v", "wmv", "flv"]);

function walk(p: string): string[] {
  if (!statSync(p).isDirectory()) return AV.has(extname(p).slice(1).toLowerCase()) ? [p] : [];
  const out: string[] = [];
  for (const n of readdirSync(p)) out.push(...walk(join(p, n)));
  return out;
}

export async function run(args: string[]): Promise<void> {
  wireLlm();
  try {
    await runMeeting(args[0], args[1]);
  } finally {
    await shutdownObservability();
  }
}

async function runMeeting(slug: string | undefined, path: string | undefined): Promise<void> {
  if (!slug || !path) {
    console.error('Uso: cortex connect-meeting "<slug>" <fichero-audio/vídeo|carpeta>');
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
    // El servidor destila (ADR-0025); aquí se espera porque el usuario mira los contadores.
    const r = await sendCondensedSession({
      slug,
      condensed: ex.text,
      sessionId: basename(file),
      platform: "meeting",
      sourceType: "meeting_transcript",
      wait: true,
    });
    const c = r.counters ?? { saved: 0, updated: 0, superseded: 0, noop: 0, failed: 0, windows: 0 };
    saved += c.saved;
    updated += c.updated;
    superseded += c.superseded;
    failed += c.failed;
    console.log(`  ${basename(file)}: +${c.saved} nuevas, ~${c.updated} fusionadas, ⊘${c.superseded} superadas${c.failed ? `, ${c.failed} fallos` : ""}`);
  }
  console.log(`Reuniones: +${saved} nuevas, ~${updated} UPDATE, ⊘${superseded} SUPERSEDE${failed ? `, ${failed} fallos (¿cortex auth login / servidor?)` : ""}.`);
}



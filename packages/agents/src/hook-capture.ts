import { existsSync } from "node:fs";
import { closeSql } from "@cortex/database";
import { resolveProjectFromCwd } from "@cortex/core";
import { ingestSessionFile } from "./connect-sessions.js";
import { shutdownObservability } from "./mastra.js";

/**
 * Hook de AUTO-CAPTURA (SessionEnd de Claude Code, y equivalentes). Lee el JSON del
 * hook por stdin (`cwd`, `transcript_path`), resuelve el proyecto (`.cortex.json`) y
 * **destila la sesión actual** a conocimiento tipado en Cortex (reutiliza la lógica de
 * connect-sessions: condensa, borra secretos, destila con el agente `distiller`).
 * Cierra el bucle "trabajas → Cortex aprende" sin que el dev haga nada. Silencioso
 * (un hook nunca rompe la sesión). Ver research/hooks-integration.md.
 *
 * Manual: echo '{"cwd":"/ruta","transcript_path":"/...jsonl"}' | tsx src/hook-capture.ts
 */

async function readStdin(): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const c of process.stdin) chunks.push(c as Buffer);
  return Buffer.concat(chunks).toString("utf8");
}

async function main(): Promise<void> {
  let input: { cwd?: string; transcript_path?: string } = {};
  try {
    input = JSON.parse((await readStdin()) || "{}");
  } catch {
    return;
  }
  const cwd = input.cwd || process.cwd();
  const transcript = input.transcript_path;
  const project = resolveProjectFromCwd(cwd);
  if (!project || !transcript || !existsSync(transcript)) return; // repo no apuntado / sin transcript

  const r = await ingestSessionFile(project, transcript, "claude");
  if (r.saved || r.updated || r.noop) console.error(`[cortex hook] "${project}": +${r.saved} nuevas, ~${r.updated} fusionadas, ${r.noop} ya cubiertas`);
}

main()
  .catch(() => {
    /* silencioso: un hook no debe romper la sesión */
  })
  .finally(async () => {
    await shutdownObservability();
    await closeSql();
    process.exit(0);
  });

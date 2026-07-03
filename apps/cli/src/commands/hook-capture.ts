import { existsSync } from "node:fs";
import { loadEnv } from "@cortex/shared";
import { closeSql } from "@cortex/database";
import { readCortexLink } from "@cortex/core";
import { captureSessionViaApi, shutdownObservability, wireLlm } from "@cortex/agents";

/**
 * Hook de AUTO-CAPTURA (SessionEnd de Claude Code, y equivalentes). Lee el JSON del
 * hook por stdin (`cwd`, `transcript_path`), resuelve el proyecto (`.cortex.json`) y
 * **destila la sesión actual** a conocimiento tipado en Cortex (reutiliza la lógica de
 * connect-sessions: condensa, borra secretos, destila con el agente `distiller`).
 * Cierra el bucle "trabajas → Cortex aprende" sin que el dev haga nada. Silencioso
 * (un hook nunca rompe la sesión). Ver research/hooks-integration.md.
 *
 * Manual: echo '{"cwd":"/ruta","transcript_path":"/...jsonl"}' | cortex hook-capture
 */

async function readStdin(): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const c of process.stdin) chunks.push(c as Buffer);
  return Buffer.concat(chunks).toString("utf8");
}

export async function run(): Promise<void> {
  wireLlm();
  let input: { cwd?: string; transcript_path?: string } = {};
  try {
    input = JSON.parse((await readStdin()) || "{}");
  } catch {
    return;
  }
  const cwd = input.cwd || process.cwd();
  const transcript = input.transcript_path;
  if (!transcript || !existsSync(transcript)) return;
  const link = readCortexLink(cwd);
  if (!link || link.ignore || !link.slug) return; // sin vínculo por slug (usa `cortex link`)

  // Vía API autenticada: la escritura se atribuye al usuario (created_by=email) y respeta permisos.
  const r = await captureSessionViaApi(link.slug, transcript, "claude");
  if (r.saved || r.updated || r.superseded || r.failed)
    console.error(`[cortex hook] "${link.slug}": +${r.saved} nuevas, ~${r.updated} fusionadas, ⊘${r.superseded} superadas, ${r.noop} ya cubiertas${r.failed ? `, ${r.failed} fallos (¿cortex auth login / servidor?)` : ""}`);
}

// Compat: los hooks instalados lo invocan directamente (script pnpm hook:capture).
if (import.meta.url === `file://${process.argv[1]}`) {
  loadEnv();
  run()
    .catch(() => {
      /* silencioso: un hook no debe romper la sesión */
    })
    .finally(async () => {
      await shutdownObservability();
      await closeSql().catch(() => {});
      process.exit(0);
    });
}

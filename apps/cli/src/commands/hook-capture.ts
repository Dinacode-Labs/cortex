import { existsSync } from "node:fs";
import { readCortexLink, sendSessionFile } from "@cortex/client";

/**
 * Hook de AUTO-CAPTURA (SessionEnd de Claude Code, y equivalentes). Lee el JSON del hook
 * por stdin (`cwd`, `transcript_path`), resuelve el proyecto (`.cortex.json`), condensa el
 * transcript —quitando tool calls, volcados y secretos— y lo manda al servidor, que es
 * quien lo destila a conocimiento tipado (ADR-0025).
 *
 * Antes destilaba aquí mismo, lo que obligaba a que cada portátil tuviera una clave de LLM.
 * Ahora este comando no necesita ni credenciales de modelo ni base de datos: solo la sesión
 * de `cortex auth login`.
 *
 * Silencioso por diseño: un hook corre dentro de la sesión de un agente y nunca debe
 * romperla. Ver research/hooks-integration.md.
 *
 * Manual: echo '{"cwd":"/ruta","transcript_path":"/...jsonl"}' | cortex hook-capture
 */

async function readStdin(): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const c of process.stdin) chunks.push(c as Buffer);
  return Buffer.concat(chunks).toString("utf8");
}

/** Comando `managed: false`: gestiona su propio exit. Traga cualquier error. */
export async function run(): Promise<void> {
  try {
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

    // No se espera al resultado: destilar tarda y el hook tiene un timeout corto. El
    // servidor encola el trabajo y responde 202.
    const r = await sendSessionFile(link.slug, transcript, "claude");
    if (r.status === "failed") {
      console.error(`[cortex hook] no se pudo capturar "${link.slug}": ${r.error ?? "error"} (¿cortex auth login / servidor?)`);
    } else if (r.status !== "duplicate") {
      console.error(`[cortex hook] sesión enviada a "${link.slug}" (el servidor la destila).`);
    }
  } catch {
    /* silencioso: un hook no debe romper la sesión */
  } finally {
    process.exit(0);
  }
}

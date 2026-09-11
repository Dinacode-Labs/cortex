import { getBrandName } from "@cortex/shared";
import { apiGet, useProjectServer } from "@cortex/client";

/**
 * Hook de INYECCIÓN DE CONTEXTO (SessionStart de Claude Code, y equivalentes). Lee el
 * JSON del hook por stdin (`cwd`), resuelve el proyecto (`.cortex.json`) y emite el
 * context-pack del proyecto como `additionalContext` para que el agente arranque
 * "sabiendo" el proyecto. Consulta la API autenticada (permisos + atribución); no usa
 * el MCP (en SessionStart aún no está conectado). Si no hay proyecto/contexto, no
 * emite nada. Ver research/hooks-integration.md.
 *
 * Uso: el hook lo invoca con el JSON por stdin. Manual: echo '{"cwd":"/ruta"}' | cortex hook-context
 */

const MAX_CTX = Number(process.env.CORTEX_HOOK_CTX_CHARS ?? "6000");

async function readStdin(): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const c of process.stdin) chunks.push(c as Buffer);
  return Buffer.concat(chunks).toString("utf8");
}

function argOf(name: string): string | undefined {
  const i = process.argv.indexOf(name);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

/**
 * Comando `managed: false`: gestiona su propio ciclo de vida. Un hook NUNCA debe romper
 * la sesión ni ensuciar stderr, así que traga cualquier error en silencio y sale con 0.
 * (loadEnv lo hace el dispatcher antes de invocar el comando.)
 */
export async function run(): Promise<void> {
  try {
    // Formato de salida por agente: claude/codex (additionalContext) | hermes ({context}) | text.
    const format = (argOf("--format") || "claude").toLowerCase();
    let input: { cwd?: string; hook_event_name?: string } = {};
    try {
      input = JSON.parse((await readStdin()) || "{}");
    } catch {
      /* sin stdin (p.ej. OpenCode pasa --cwd) */
    }
    const cwd = argOf("--cwd") || input.cwd || process.cwd();
    const link = useProjectServer(cwd);
    if (!link || link.ignore || !link.slug) return; // sin vínculo por slug (usa `cortex link`)

    // Vía API autenticada (no toca la BD): respeta permisos y no expone proyectos sin acceso.
    const res = await apiGet<{ project: string; text: string }>(`/context-pack?slug=${encodeURIComponent(link.slug)}`);
    if (!res || !res.text.trim()) return; // sin sesión, sin servidor, sin acceso, o pack vacío

    const additionalContext = `## ${getBrandName()} context — project "${res.project}"\nLiving project memory (current decisions, constraints, risks). Check it before touching a module, and capture what is new.\n\n${res.text.slice(0, MAX_CTX)}`;

    if (format === "hermes") {
      process.stdout.write(JSON.stringify({ context: additionalContext })); // Hermes pre_llm_call
    } else if (format === "text") {
      process.stdout.write(additionalContext); // OpenCode plugin lee stdout
    } else {
      process.stdout.write(JSON.stringify({ hookSpecificOutput: { hookEventName: input.hook_event_name || "SessionStart", additionalContext } })); // Claude / Codex
    }
  } catch {
    /* un hook nunca debe romper la sesión: silencioso */
  } finally {
    process.exit(0);
  }
}

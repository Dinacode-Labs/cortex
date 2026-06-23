import { closeSql } from "@cortex/database";
import { getContextPack } from "./operations.js";
import { renderContextPack } from "./render.js";
import { resolveProjectFromCwd } from "./project-config.js";

/**
 * Hook de INYECCIÓN DE CONTEXTO (SessionStart de Claude Code, y equivalentes). Lee el
 * JSON del hook por stdin (`cwd`), resuelve el proyecto (`.cortex.json`) y emite el
 * context-pack del proyecto como `additionalContext` para que el agente arranque
 * "sabiendo" el proyecto. No usa el MCP (en SessionStart aún no está conectado): va
 * directo a la BD. Si no hay proyecto/contexto, no emite nada. Ver
 * research/hooks-integration.md.
 *
 * Uso: el hook lo invoca con el JSON por stdin. Manual: echo '{"cwd":"/ruta"}' | tsx src/hook-context.ts
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

async function main(): Promise<void> {
  // Formato de salida por agente: claude/codex (additionalContext) | hermes ({context}) | text.
  const format = (argOf("--format") || "claude").toLowerCase();
  let input: { cwd?: string; hook_event_name?: string } = {};
  try {
    input = JSON.parse((await readStdin()) || "{}");
  } catch {
    /* sin stdin (p.ej. OpenCode pasa --cwd) */
  }
  const cwd = argOf("--cwd") || input.cwd || process.cwd();
  const project = resolveProjectFromCwd(cwd);
  if (!project) return; // repo no apuntado a Cortex (sin .cortex.json)

  let pack = "";
  try {
    pack = renderContextPack(await getContextPack(project)).slice(0, MAX_CTX);
  } catch {
    return;
  }
  if (!pack.trim()) return;

  const additionalContext = `## Contexto de Dinacode Cortex — proyecto "${project}"\nMemoria viva del proyecto (decisiones vigentes, restricciones, riesgos). Consúltala antes de tocar un módulo y captura lo nuevo.\n\n${pack}`;

  if (format === "hermes") {
    process.stdout.write(JSON.stringify({ context: additionalContext })); // Hermes pre_llm_call
  } else if (format === "text") {
    process.stdout.write(additionalContext); // OpenCode plugin lee stdout
  } else {
    process.stdout.write(JSON.stringify({ hookSpecificOutput: { hookEventName: input.hook_event_name || "SessionStart", additionalContext } })); // Claude / Codex
  }
}

main()
  .catch(() => {
    /* un hook nunca debe romper la sesión: silencioso */
  })
  .finally(async () => {
    await closeSql();
    process.exit(0);
  });

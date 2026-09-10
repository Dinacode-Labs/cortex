import { resolve } from "node:path";
import { getBrandName, loadEnv } from "@cortex/shared";
import { closeSql } from "@cortex/database";

/**
 * CLI `cortex` — dispatcher único (estilo `gh`). Cada subcomando vive en
 * ./commands/<nombre>.ts y exporta `run(args)`. La carga es perezosa con rutas
 * LITERALES (no se paga el arranque de mastra/pg para `--help`, y no se muta
 * process.argv). El ciclo de vida (loadEnv, closeSql, exit code) lo gestiona
 * este dispatcher. Instalado en el PATH por `cortex sync` (shim a ~/.local/bin).
 */
const REPO = resolve(import.meta.dirname, "../../..");

type CommandModule = { run: (args: string[]) => Promise<void> };

interface Cmd {
  help: string;
  load: () => Promise<CommandModule>;
  /** false = el script gestiona su propio ciclo de vida (servidores, legacy). */
  managed?: boolean;
}

/** Entrypoints de otras apps (arrancan un servidor al importarse). */
function boot(script: string, help: string): Cmd {
  return { help, managed: false, load: async () => ({ run: async () => void (await import(resolve(REPO, script))) }) };
}

const COMMANDS: Record<string, Cmd> = {
  auth: { help: "iniciar sesión por email + OTP (login/status/logout)", load: () => import("./commands/auth.js") },
  ui: { help: "abrir la UI web ya autenticada (sin OTP)", load: () => import("./commands/ui.js") },
  link: { help: "vincular/crear el proyecto de esta carpeta (escribe .cortex.json)", load: () => import("./commands/link.js") },
  seed: { help: "cargar los datos de demo (proyecto ficticio Acme Portal)", load: () => import("./commands/seed.js") },
  ingest: { help: "ingesta masiva de contexto desde un JSON de items", load: () => import("./commands/ingest.js") },
  lint: { help: "salud del conocimiento de un proyecto (contradicciones, huecos…)", load: () => import("./commands/lint.js") },
  "lint-act": { help: "plan de acciones (dry-run) a partir del lint", load: () => import("./commands/lint-act.js") },
  temporal: { help: "invalidación temporal: cierra la validez de hechos no vigentes", load: () => import("./commands/temporal.js") },
  "index-code": { help: "indexar el código de un repo local en un proyecto", load: () => import("./commands/index-code.js") },
  "resolve-entities": { help: "fusionar variantes de entidades en una canónica", load: () => import("./commands/resolve-entities.js") },
  "connect-github": { help: "ingerir PRs/issues de un repo de GitHub (vía gh)", load: () => import("./commands/connect-github.js") },
  "connect-docs": { help: "ingerir una carpeta de documentos (Word/PDF/Excel/…)", load: () => import("./commands/connect-docs.js") },
  "connect-notion": { help: "ingerir un export de Notion (páginas + adjuntos)", load: () => import("./commands/connect-notion.js") },
  "hook-context": { help: "hook SessionStart: emite el context-pack del proyecto vinculado", managed: false, load: () => import("./commands/hook-context.js") },
  server: boot("apps/server/src/index.ts", "arrancar el servidor HTTP de Cortex (API + auth)"),
  "mcp-http": boot("apps/mcp-server/src/http.ts", "arrancar el MCP por HTTP autenticado (Streamable HTTP)"),
  "connect-sessions": { help: "backfill de sesiones de un agente a un proyecto", load: () => import("./commands/connect-sessions.js") },
  "connect-meeting": { help: "transcribir + destilar grabaciones de reunión", load: () => import("./commands/connect-meeting.js") },
  "hook-capture": { help: "hook SessionEnd: destila la sesión y la captura en Cortex", managed: false, load: () => import("./commands/hook-capture.js") },
  enrich: { help: "pase de enriquecimiento de grafo (entidades + relaciones) de un proyecto", load: () => import("./commands/enrich.js") },
  maintain: { help: "mantenimiento: enrich/resolve/temporal/curate/reconcile/lint", load: () => import("./commands/maintain.js") },
  "maintain-worker": { help: "worker de mantenimiento programado (cron)", managed: false, load: () => import("./commands/maintain-worker.js") },
  sync: { help: "instalar/actualizar el toolbelt en tus agentes (MCP, skills, hooks)", load: () => import("./commands/sync.js") },
};

function usage(): void {
  console.log(`cortex — ${getBrandName()}: memoria de contexto de proyectos software\n`);
  console.log("Uso: cortex <comando> [args]\n");
  console.log("Comandos:");
  const w = Math.max(...Object.keys(COMMANDS).map((k) => k.length));
  for (const [name, c] of Object.entries(COMMANDS)) console.log(`  ${name.padEnd(w)}  ${c.help}`);
  console.log('\nEjemplos:\n  cortex link --create "Mi Proyecto"\n  cortex maintain "Mi Proyecto"\n  cortex sync --apply');
}

async function main(): Promise<void> {
  const [sub, ...rest] = process.argv.slice(2);
  if (!sub || sub === "help" || sub === "--help" || sub === "-h") {
    usage();
    return;
  }
  const cmd = COMMANDS[sub];
  if (!cmd) {
    console.error(`Comando desconocido: "${sub}"\n`);
    usage();
    process.exit(1);
  }
  loadEnv();
  const mod = await cmd.load();
  if (cmd.managed === false) {
    // Servidores y scripts legacy: gestionan su propio shutdown/exit.
    await mod.run(rest);
    return;
  }
  try {
    await mod.run(rest);
  } catch (e) {
    console.error(`Error en cortex ${sub}:`, e instanceof Error ? e.message : e);
    process.exitCode = 1;
  } finally {
    await closeSql().catch(() => {});
    process.exit(process.exitCode ?? 0);
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});

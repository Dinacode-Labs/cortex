import { getBrandName } from "@cortex/shared";

/**
 * CLI `cortex` — dispatcher único (estilo `gh`). Cada subcomando vive en
 * ./commands/<nombre>.ts y exporta `run(args)`, y la carga es perezosa con rutas LITERALES
 * (arrancar `--help` no debe pagar el coste de cargar nada).
 *
 * Aquí SOLO viven los comandos de developer: los que necesitan la base de datos, el modelo
 * o levantar un servicio están en `cortex-admin` (ADR-0025). Es lo que permite que este
 * binario se instale con `npm i -g` sin arrastrar Postgres ni Mastra: si añades un comando
 * que importa `@cortex/database`, `core`, `agents` o `embeddings`, va en admin, no aquí
 * (hay un test que lo comprueba).
 */
type CommandModule = { run: (args: string[]) => Promise<void> };

interface Cmd {
  help: string;
  load: () => Promise<CommandModule>;
  /** false = el comando gestiona su propio ciclo de vida (hooks, procesos largos). */
  managed?: boolean;
}

const COMMANDS: Record<string, Cmd> = {
  auth: { help: "iniciar sesión por email + OTP (login/status/logout)", load: () => import("./commands/auth.js") },
  link: { help: "vincular/crear el proyecto de esta carpeta (escribe .cortex.json)", load: () => import("./commands/link.js") },
  ui: { help: "abrir la UI web ya autenticada (sin OTP)", load: () => import("./commands/ui.js") },
  sync: { help: "instalar/actualizar el toolbelt en tus agentes (MCP, skills, hooks)", load: () => import("./commands/sync.js") },
  "connect-github": { help: "ingerir PRs/issues de un repo de GitHub (vía gh)", load: () => import("./commands/connect-github.js") },
  "connect-sessions": { help: "backfill de sesiones de un agente a un proyecto", load: () => import("./commands/connect-sessions.js") },
  "hook-context": { help: "hook SessionStart: emite el context-pack del proyecto vinculado", managed: false, load: () => import("./commands/hook-context.js") },
  "hook-capture": { help: "hook SessionEnd: envía la sesión a Cortex para que la destile", managed: false, load: () => import("./commands/hook-capture.js") },
};

function usage(): void {
  console.log(`cortex — ${getBrandName()}: memoria de contexto de proyectos software\n`);
  console.log("Uso: cortex <comando> [args]\n");
  console.log("Comandos:");
  const w = Math.max(...Object.keys(COMMANDS).map((k) => k.length));
  for (const [name, c] of Object.entries(COMMANDS)) console.log(`  ${name.padEnd(w)}  ${c.help}`);
  console.log('\nEjemplos:\n  cortex auth login\n  cortex link --create "Mi Proyecto"\n  cortex sync --apply');
  console.log("\nLos comandos de operador (migrate, maintain, ingest…) están en `cortex-admin`.");
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
  const mod = await cmd.load();
  if (cmd.managed === false) {
    await mod.run(rest); // hooks: gestionan su propio exit
    return;
  }
  try {
    await mod.run(rest);
  } catch (e) {
    console.error(`Error en cortex ${sub}:`, e instanceof Error ? e.message : e);
    process.exitCode = 1;
  }
  process.exit(process.exitCode ?? 0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});

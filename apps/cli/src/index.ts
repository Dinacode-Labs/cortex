import { getBrandName } from "@cortex/shared";
import { printVersionNotice } from "./compat.js";
import { CLI_VERSION } from "./version.js";

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
  /**
   * false = el comando gestiona su propio ciclo de vida (hooks, procesos largos). Además, NO
   * recibe el aviso de versión al terminar: en los hooks y en `cortex mcp` stdout es
   * protocolo y cualquier byte de más rompe la sesión del agente.
   */
  managed?: boolean;
  /** false = el comando ya habla de versiones por sí mismo; el aviso del final sobraría. */
  versionNotice?: boolean;
}

const COMMANDS: Record<string, Cmd> = {
  auth: { help: "sign in with your email and a one-time code (login/status/logout)", load: () => import("./commands/auth.js") },
  link: { help: "link this folder to a project, or create one (writes .cortex.json)", load: () => import("./commands/link.js") },
  ui: { help: "open the web UI, already signed in", load: () => import("./commands/ui.js") },
  setup: { help: "wire your coding agents (Claude Code, Codex, …) into Cortex", load: () => import("./commands/setup.js") },
  mem: { help: "project memory from the terminal: save, search, read and fix entries", load: () => import("./commands/mem.js") },
  mcp: { help: "MCP server over stdio for your agent (proxies to the Cortex server)", managed: false, load: () => import("./commands/mcp.js") },
  toolbelt: { help: "install your organisation's toolbelt (third-party MCPs and skills)", load: () => import("./commands/toolbelt.js") },
  version: { help: "this CLI's version and the server's", versionNotice: false, load: () => import("./commands/version.js") },
  upgrade: { help: "install the latest published version of this CLI", versionNotice: false, load: () => import("./commands/upgrade.js") },
  doctor: { help: "check every piece is in place, and say what to do if not", versionNotice: false, load: () => import("./commands/doctor.js") },
  "connect-docs": { help: "ingest a folder of documentation into a project", load: () => import("./commands/connect-docs.js") },
  "connect-github": { help: "ingest pull requests and issues from a GitHub repo", load: () => import("./commands/connect-github.js") },
  "connect-sessions": { help: "backfill past agent sessions into a project", load: () => import("./commands/connect-sessions.js") },
  "hook-context": { help: "session-start hook: emit the linked project's context pack", managed: false, load: () => import("./commands/hook-context.js") },
  "hook-capture": { help: "session-end hook: send the session to Cortex to be distilled", managed: false, load: () => import("./commands/hook-capture.js") },
};

function usage(): void {
  console.log(`cortex ${CLI_VERSION} — ${getBrandName()}: project memory for software teams\n`);
  console.log("Usage: cortex <command> [args]\n");
  console.log("Commands:");
  const w = Math.max(...Object.keys(COMMANDS).map((k) => k.length));
  for (const [name, c] of Object.entries(COMMANDS)) console.log(`  ${name.padEnd(w)}  ${c.help}`);
  console.log('\nExamples:\n  cortex auth login\n  cortex setup --all\n  cortex link --create "My Project"');
  console.log("\nOperator commands (migrate, maintain, ingest, …) live in `cortex-admin`.");
}

async function main(): Promise<void> {
  const [sub, ...rest] = process.argv.slice(2);
  if (!sub || sub === "help" || sub === "--help" || sub === "-h") {
    usage();
    return;
  }
  if (sub === "--version" || sub === "-v") {
    console.log(CLI_VERSION);
    return;
  }
  if (sub === "sync") {
    // `cortex sync` hacía dos cosas distintas a la vez; ahora son dos comandos (ADR-0032).
    console.error("`cortex sync` is gone. It did two different things, and now they are two commands:\n");
    console.error("  cortex setup --all        wire Cortex into your agents (hooks, MCP, skill)");
    console.error("  cortex toolbelt sync      install your organisation's MCPs and skills");
    process.exit(1);
  }
  const cmd = COMMANDS[sub];
  if (!cmd) {
    console.error(`Unknown command: "${sub}"\n`);
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
    console.error(`cortex ${sub} failed:`, e instanceof Error ? e.message : e);
    process.exitCode = 1;
  }
  // Aviso pasivo de versión (ADR-0062): una línea a stderr, solo con terminal delante y como
  // mucho una vez al día. Solo llega aquí un comando interactivo; los `managed: false` ya
  // salieron arriba.
  if (cmd.versionNotice !== false) await printVersionNotice();
  process.exit(process.exitCode ?? 0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});

import { loadEnv } from "@cortex/shared";
import { closeSql } from "@cortex/database";

/**
 * `cortex-admin` — comandos de OPERADOR: los que hablan con la base de datos, llaman al
 * modelo o arrancan un servicio. Viven en la imagen de despliegue, no en el portátil de
 * cada dev.
 *
 * Está separado del CLI `cortex` a propósito (ADR-0025): mientras esos comandos vivían en
 * el mismo binario, instalar Cortex significaba arrastrar Postgres, Mastra y la extracción
 * documental a la máquina de cualquiera que solo quisiera vincular un repo.
 *
 * Uso típico en producción:
 *   docker compose exec server node apps/admin/dist/index.js maintain "Mi Proyecto"
 */
type CommandModule = { run: (args: string[]) => Promise<void> };

interface Cmd {
  help: string;
  load: () => Promise<CommandModule>;
  /** false = el comando gestiona su propio ciclo de vida (servidores, workers). */
  managed?: boolean;
}

/** Arranca otra app importando su entrypoint (que levanta el servidor al cargarse). */
function boot(load: () => Promise<unknown>, help: string): Cmd {
  return { help, managed: false, load: async () => ({ run: async () => void (await load()) }) };
}

const COMMANDS: Record<string, Cmd> = {
  // --- Servicios ---
  server: boot(() => import("@cortex/server/start"), "arrancar la API HTTP (auth + contexto)"),
  "mcp-http": boot(() => import("@cortex/mcp-server/http"), "arrancar el MCP por HTTP autenticado"),
  "maintain-worker": { help: "worker de mantenimiento programado (cron)", managed: false, load: () => import("./commands/maintain-worker.js") },

  // --- Esquema y datos ---
  migrate: { help: "aplicar las migraciones pendientes de la base de datos", load: () => import("./commands/migrate.js") },
  seed: { help: "cargar los datos de demo (proyecto ficticio Acme Portal)", load: () => import("./commands/seed.js") },
  ingest: { help: "ingesta masiva de contexto desde un JSON de items", load: () => import("./commands/ingest.js") },

  // --- Curación del conocimiento ---
  maintain: { help: "mantenimiento: enrich/resolve/temporal/curate/reconcile/lint", load: () => import("./commands/maintain.js") },
  enrich: { help: "pase de enriquecimiento de grafo (entidades + relaciones)", load: () => import("./commands/enrich.js") },
  lint: { help: "salud del conocimiento de un proyecto (contradicciones, huecos…)", load: () => import("./commands/lint.js") },
  "lint-act": { help: "plan de acciones (dry-run) a partir del lint", load: () => import("./commands/lint-act.js") },
  temporal: { help: "invalidación temporal: cierra la validez de hechos no vigentes", load: () => import("./commands/temporal.js") },
  "resolve-entities": { help: "fusionar variantes de entidades en una canónica", load: () => import("./commands/resolve-entities.js") },
  "index-code": { help: "indexar el código de un repo local en un proyecto", load: () => import("./commands/index-code.js") },

  // --- Conectores pesados (extracción local: Office, PDF, audio, visión) ---
  "connect-docs": { help: "ingerir una carpeta de documentos (Word/PDF/Excel/…)", load: () => import("./commands/connect-docs.js") },
  "connect-notion": { help: "ingerir un export de Notion (páginas + adjuntos)", load: () => import("./commands/connect-notion.js") },
  "connect-meeting": { help: "transcribir grabaciones de reunión e ingerirlas", load: () => import("./commands/connect-meeting.js") },
};

function usage(): void {
  console.log("cortex-admin — comandos de operador de Cortex (requieren acceso a la base de datos)\n");
  console.log("Uso: cortex-admin <comando> [args]\n");
  console.log("Comandos:");
  const w = Math.max(...Object.keys(COMMANDS).map((k) => k.length));
  for (const [name, c] of Object.entries(COMMANDS)) console.log(`  ${name.padEnd(w)}  ${c.help}`);
  console.log('\nEjemplos:\n  cortex-admin migrate\n  cortex-admin maintain "Mi Proyecto"\n  cortex-admin connect-docs "Mi Proyecto" ./docs');
  console.log("\nLos comandos de developer (auth, link, hooks, mcp) están en el CLI `cortex`.");
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
    // Servidores y workers: gestionan su propio shutdown.
    await mod.run(rest);
    return;
  }
  try {
    await mod.run(rest);
  } catch (e) {
    console.error(`Error en cortex-admin ${sub}:`, e instanceof Error ? e.message : e);
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

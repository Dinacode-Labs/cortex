import { loadEnv } from "@cortex/shared";
import { closeSql } from "@cortex/database";

/**
 * `cortex-admin` -- OPERATOR commands: the ones that talk to the database, call the model or
 * start a service. They live in the deployment image, not on every dev's laptop.
 *
 * It is separated from the `cortex` CLI on purpose (ADR-0025): while those commands lived in
 * the same binary, installing Cortex meant dragging Postgres, Mastra and document extraction
 * onto the machine of anyone who only wanted to link a repo.
 *
 * Typical production usage:
 *   docker compose exec server node apps/admin/dist/index.js maintain "My Project"
 */
type CommandModule = { run: (args: string[]) => Promise<void> };

interface Cmd {
  help: string;
  load: () => Promise<CommandModule>;
  /** false = the command manages its own lifecycle (servers, workers). */
  managed?: boolean;
}

/** Starts another app by importing its entrypoint (which stands the server up on load). */
function boot(load: () => Promise<unknown>, help: string): Cmd {
  return { help, managed: false, load: async () => ({ run: async () => void (await load()) }) };
}

const COMMANDS: Record<string, Cmd> = {
  // --- Services ---
  server: boot(() => import("@cortex/server/start"), "start the HTTP API (auth + context)"),
  "mcp-http": boot(() => import("@cortex/mcp-server/http"), "start the authenticated MCP over HTTP"),
  "maintain-worker": { help: "scheduled maintenance worker (cron)", managed: false, load: () => import("./commands/maintain-worker.js") },

  // --- Schema and data ---
  migrate: { help: "apply the database's pending migrations", load: () => import("./commands/migrate.js") },
  seed: { help: "load the demo data (the fictional Acme Portal project)", load: () => import("./commands/seed.js") },
  ingest: { help: "bulk context ingestion from a JSON of items", load: () => import("./commands/ingest.js") },

  // --- Knowledge curation ---
  maintain: { help: "maintenance: enrich/resolve/temporal/curate/reconcile/lint", load: () => import("./commands/maintain.js") },
  enrich: { help: "graph enrichment pass (entities + relations)", load: () => import("./commands/enrich.js") },
  lint: { help: "a project's knowledge health (contradictions, gaps...)", load: () => import("./commands/lint.js") },
  eval: { help: "measure retrieval against the question set with annotated evidence", load: () => import("./commands/eval.js") },
  "eval-distill": { help: "measure what the distiller keeps, drops and mistypes", load: () => import("./commands/eval-distill.js") },
  "lint-act": { help: "action plan (dry run) derived from the lint", load: () => import("./commands/lint-act.js") },
  temporal: { help: "temporal invalidation: closes the validity of facts no longer current", load: () => import("./commands/temporal.js") },
  "resolve-entities": { help: "merge entity variants into a canonical one", load: () => import("./commands/resolve-entities.js") },
  "index-code": { help: "index a local repo's code into a project", load: () => import("./commands/index-code.js") },

  // --- Heavy connectors (local extraction: Office, PDF, audio, vision) ---
  "connect-docs": { help: "ingest a folder of documents (Word/PDF/Excel/...)", load: () => import("./commands/connect-docs.js") },
  "connect-notion": { help: "ingest a Notion export (pages + attachments)", load: () => import("./commands/connect-notion.js") },
  "connect-meeting": { help: "transcribe meeting recordings and ingest them", load: () => import("./commands/connect-meeting.js") },
};

function usage(): void {
  console.log("cortex-admin — Cortex operator commands (they need database access)\n");
  console.log("Usage: cortex-admin <command> [args]\n");
  console.log("Commands:");
  const w = Math.max(...Object.keys(COMMANDS).map((k) => k.length));
  for (const [name, c] of Object.entries(COMMANDS)) console.log(`  ${name.padEnd(w)}  ${c.help}`);
  console.log('\nExamples:\n  cortex-admin migrate\n  cortex-admin maintain "My Project"\n  cortex-admin connect-docs "My Project" ./docs');
  console.log("\nThe developer commands (auth, link, hooks, mcp) live in the `cortex` CLI.");
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
    // Servers and workers: they handle their own shutdown.
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

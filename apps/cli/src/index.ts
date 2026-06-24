import { resolve } from "node:path";

/**
 * CLI `cortex` — dispatcher único (estilo `gh`). Enruta cada subcomando al script
 * existente y lo ejecuta EN PROCESO vía import dinámico (ya corremos bajo tsx, así que
 * no hace falta otro arranque). Cada script lee `process.argv`; los que tienen guard
 * `import.meta.url === argv[1]` (maintain, connect-sessions) se activan porque fijamos
 * argv[1] = su ruta. Instalado en el PATH por `cortex sync` (shim a ~/.local/bin).
 */
const REPO = resolve(import.meta.dirname, "../../..");

interface Cmd {
  script: string;
  help: string;
}

const COMMANDS: Record<string, Cmd> = {
  auth: { script: "apps/cli/src/auth.ts", help: "iniciar sesión por email + OTP (login/status/logout)" },
  ui: { script: "apps/cli/src/ui.ts", help: "abrir la UI web ya autenticada (sin OTP)" },
  server: { script: "apps/server/src/index.ts", help: "arrancar el servidor HTTP de Cortex (API + auth)" },
  link: { script: "packages/core/src/link.ts", help: "vincular/crear el proyecto de esta carpeta (escribe .cortex.json)" },
  sync: { script: "scripts/cortex-sync.ts", help: "instalar/actualizar el toolbelt en tus agentes (MCP, skills, hooks)" },
  maintain: { script: "packages/agents/src/maintain.ts", help: "mantenimiento: enrich/resolve/temporal/curate/reconcile/lint" },
  "connect-notion": { script: "packages/core/src/connect-notion-export.ts", help: "ingerir un export de Notion (páginas + adjuntos)" },
  "connect-docs": { script: "packages/core/src/connect-docs.ts", help: "ingerir una carpeta de documentos (Word/PDF/Excel/…)" },
  "connect-github": { script: "packages/core/src/connect-github.ts", help: "ingerir PRs/issues de un repo de GitHub" },
  "connect-sessions": { script: "packages/agents/src/connect-sessions.ts", help: "backfill de sesiones de un agente a un proyecto" },
};

function usage(): void {
  console.log("cortex — memoria de contexto corporativa de Dinacode\n");
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
  const script = resolve(REPO, cmd.script);
  // Los scripts leen process.argv (y algunos comparan import.meta.url con argv[1]).
  process.argv = [process.argv[0]!, script, ...rest];
  await import(script);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});

import { AGENT_IDS, agentBin, defaultCtx, detectAgents, getAdapter, runSetup, type AgentId } from "../setup/index.js";

/**
 * `cortex setup` — deja los agentes de este portátil hablando con Cortex.
 *
 *   cortex setup <agente>|--all [--dry-run] [--remove] [--no-plugin]
 *   cortex setup --status
 *
 * Instalar el CLI y configurar los agentes son cosas distintas a propósito: se puede volver a
 * ejecutar esto tantas veces como haga falta sin reinstalar nada. Es idempotente, hace copia
 * de los ficheros antes de tocarlos y `--dry-run` cuenta lo que haría sin escribir.
 */

function usage(): void {
  console.log("Uso: cortex setup <agente>|--all [--dry-run] [--remove] [--no-plugin]");
  console.log("     cortex setup --status\n");
  console.log(`Agentes: ${AGENT_IDS.join(", ")}\n`);
  console.log("  --dry-run     enseña lo que haría, sin escribir nada");
  console.log("  --remove      quita la integración de Cortex (no desinstala el CLI)");
  console.log("  --no-plugin   Claude Code: hooks en settings.json en vez del plugin");
}

function printReports(results: { id: string; report: { changed: string[]; skipped: string[]; warnings: string[] } }[], dryRun: boolean): boolean {
  let nada = true;
  for (const { id, report } of results) {
    console.log(`\n[${id}]`);
    for (const c of report.changed) {
      console.log(`  ${dryRun ? "•" : "✓"} ${c}`);
      nada = false;
    }
    for (const s of report.skipped) console.log(`  · ${s}`);
    // Los avisos no cuentan como cambio: hay agentes que siempre tienen algo que recordar.
    for (const w of report.warnings) console.log(`  ⚠️  ${w}`);
    if (!report.changed.length && !report.skipped.length && !report.warnings.length) console.log("  · nada que hacer");
  }
  return nada;
}

async function showStatus(ctx: ReturnType<typeof defaultCtx>): Promise<void> {
  const detected = detectAgents(ctx);
  console.log(detected.length ? `Agentes detectados: ${detected.join(", ")}` : "No he detectado ningún agente en este equipo.");
  for (const id of detected) {
    const adapter = getAdapter(id);
    console.log(`\n[${id}]`);
    if (!adapter) {
      console.log("  · sin integración automática en esta versión");
      continue;
    }
    const st = await adapter.status(ctx);
    console.log(`  ${st.installed ? "✓ configurado" : "✗ sin configurar"}`);
    for (const d of st.details) console.log(`    - ${d}`);
  }
  const sinConfigurar = detected.filter((id) => getAdapter(id));
  if (sinConfigurar.length) console.log(`\nPara (re)configurar: cortex setup --all`);
}

export async function run(args: string[]): Promise<void> {
  const flags = new Set(args.filter((a) => a.startsWith("--")));
  const ctx = defaultCtx({
    dryRun: flags.has("--dry-run"),
    remove: flags.has("--remove"),
    noPlugin: flags.has("--no-plugin"),
  });

  if (flags.has("--help") || flags.has("-h")) {
    usage();
    return;
  }
  if (flags.has("--status")) {
    await showStatus(ctx);
    return;
  }

  const named = args.filter((a) => !a.startsWith("--")) as AgentId[];
  const desconocido = named.find((a) => !AGENT_IDS.includes(a));
  if (desconocido) {
    console.error(`Agente desconocido: "${desconocido}". Conocidos: ${AGENT_IDS.join(", ")}`);
    process.exitCode = 1;
    return;
  }

  const detected = detectAgents(ctx);
  let agents: AgentId[];
  if (flags.has("--all")) {
    agents = detected;
    if (agents.length === 0) {
      console.log("No he detectado ningún agente en este equipo. Instala Claude Code, Codex, OpenCode, Hermes o Pi y vuelve a ejecutarlo.");
      return;
    }
  } else if (named.length) {
    agents = named;
    const ausentes = named.filter((id) => !ctx.detect(agentBin(id)));
    for (const id of ausentes) console.log(`⚠️  No encuentro \`${agentBin(id)}\` en el PATH; configuro ${id} igualmente por si lo instalas después.`);
  } else {
    usage();
    console.log("");
    await showStatus(ctx);
    return;
  }

  console.log(`cortex setup ${ctx.remove ? "(DESINSTALAR)" : ctx.dryRun ? "(dry-run — no escribo nada)" : ""}`.trimEnd());
  const results = await runSetup(agents, ctx);
  const nada = printReports(results, ctx.dryRun);

  if (ctx.dryRun) console.log("\nEsto era un simulacro. Ejecuta lo mismo sin --dry-run para aplicarlo.");
  else if (ctx.remove) console.log("\nIntegración retirada. El CLI `cortex` sigue instalado.");
  else if (nada) console.log("\nTodo estaba ya en su sitio.");
  else console.log("\nListo. Reinicia tus agentes para que carguen la configuración nueva.");
}

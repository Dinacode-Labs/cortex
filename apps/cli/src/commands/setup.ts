import { getBrandName } from "@cortex/shared";
import { AGENT_IDS, agentBin, defaultCtx, detectAgents, getAdapter, runSetup, type AgentId } from "../setup/index.js";

/**
 * `cortex setup` -- leaves this laptop's agents talking to Cortex.
 *
 *   cortex setup <agent>|--all [--dry-run] [--remove] [--no-plugin]
 *   cortex setup --status
 *
 * Installing the CLI and configuring the agents are deliberately different things: this can be
 * run again as many times as needed without reinstalling anything. It is idempotent, it backs
 * the files up before touching them, and `--dry-run` reports what it would do without writing.
 */

function usage(): void {
  console.log("Usage: cortex setup <agent>|--all [--dry-run] [--remove] [--no-plugin]");
  console.log("       cortex setup --status\n");
  console.log(`Agents: ${AGENT_IDS.join(", ")}\n`);
  console.log("  --dry-run     show what it would do, without writing anything");
  console.log(`  --remove      remove the ${getBrandName()} integration (the CLI stays installed)`);
  console.log("  --no-plugin   Claude Code: hooks in settings.json instead of the plugin");
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
    // Warnings do not count as a change: some agents always have something to remind you of.
    for (const w of report.warnings) console.log(`  ⚠️  ${w}`);
    if (!report.changed.length && !report.skipped.length && !report.warnings.length) console.log("  · nothing to do");
  }
  return nada;
}

async function showStatus(ctx: ReturnType<typeof defaultCtx>): Promise<void> {
  const detected = detectAgents(ctx);
  console.log(detected.length ? `Agents found: ${detected.join(", ")}` : "No coding agents found on this machine.");
  for (const id of detected) {
    const adapter = getAdapter(id);
    console.log(`\n[${id}]`);
    if (!adapter) {
      console.log("  · no automatic integration in this version");
      continue;
    }
    const st = await adapter.status(ctx);
    console.log(`  ${st.installed ? "✓ configured" : "✗ not configured"}`);
    for (const d of st.details) console.log(`    - ${d}`);
  }
  const sinConfigurar = detected.filter((id) => getAdapter(id));
  if (sinConfigurar.length) console.log(`\nTo (re)configure: cortex setup --all`);
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
    console.error(`Unknown agent: "${desconocido}". Known agents: ${AGENT_IDS.join(", ")}`);
    process.exitCode = 1;
    return;
  }

  const detected = detectAgents(ctx);
  let agents: AgentId[];
  if (flags.has("--all")) {
    agents = detected;
    if (agents.length === 0) {
      console.log("No coding agents found on this machine. Install Claude Code, Codex, OpenCode, Hermes or Pi and run this again.");
      return;
    }
  } else if (named.length) {
    agents = named;
    const ausentes = named.filter((id) => !ctx.detect(agentBin(id)));
    for (const id of ausentes) console.log(`⚠️  \`${agentBin(id)}\` is not on your PATH; configuring ${id} anyway, in case you install it later.`);
  } else {
    usage();
    console.log("");
    await showStatus(ctx);
    return;
  }

  console.log(`cortex setup ${ctx.remove ? "(REMOVING)" : ctx.dryRun ? "(dry run — nothing will be written)" : ""}`.trimEnd());
  const results = await runSetup(agents, ctx);
  const nada = printReports(results, ctx.dryRun);

  if (ctx.dryRun) console.log("\nThat was a dry run. Run the same command without --dry-run to apply it.");
  else if (ctx.remove) console.log("\nIntegration removed. The `cortex` CLI is still installed.");
  else if (nada) console.log("\nEverything was already in place.");
  else console.log("\nDone. Restart your agents so they pick up the new configuration.");
}

import { defaultCtx, detectAgents, type AgentId } from "../setup/index.js";
import { auditToolbelt, installToolbelt } from "../toolbelt/install.js";
import { loadRegistry } from "../toolbelt/registry.js";
import { getClientConfig, readCredentials } from "@cortex/client";

/**
 * `cortex toolbelt` -- installs YOUR organisation's toolbelt (the MCPs, skills and commands for
 * the tools your team uses) into this machine's agents.
 *
 * It is not the same as `cortex setup`: that installs Cortex. This installs everything else,
 * which is why the registry lives outside this repo, usually in a private one (ADR-0014
 * revised, ADR-0026).
 *
 *   cortex toolbelt sync --registry <path|url> [--repo <dir>] [--agents a,b] [--apply]
 *   cortex toolbelt doctor --registry <path|url>
 *
 * DRY-RUN by default: without `--apply` it only reports what it would do.
 */

function usage(): void {
  console.log("Usage: cortex toolbelt sync [--registry <path|url>] [--repo <dir>] [--agents a,b] [--apply]");
  console.log("       cortex toolbelt doctor [--registry <path|url>]\n");
  console.log("  --registry  your organisation's registry (defaults to the one your server publishes)");
  console.log("  --repo      a local checkout of the registry: needed for skills, commands and {REPO} paths");
  console.log("  --agents    limit to these agents (defaults to the ones found)");
  console.log("  --apply     actually write (without it this is a dry run)\n");
  console.log("Installing Cortex itself is a different command: `cortex setup --all`.");
}

function flag(args: string[], name: string): string | undefined {
  const i = args.indexOf(`--${name}`);
  if (i >= 0 && args[i + 1] && !args[i + 1]!.startsWith("--")) return args[i + 1];
  return args.find((a) => a.startsWith(`--${name}=`))?.split("=").slice(1).join("=");
}

/** Without `--registry`, the server is asked: it is what knows which one the team uses. */
async function defaultRegistry(): Promise<string | null> {
  const creds = readCredentials();
  if (!creds) return null;
  const cfg = await getClientConfig(creds.server);
  const base = (cfg?.apiUrl || creds.server).replace(/\/$/, "");
  return `${base}/toolbelt.json`;
}

export async function run(args: string[]): Promise<void> {
  const sub = args[0];
  if (!sub || sub === "--help" || sub === "-h" || !["sync", "doctor"].includes(sub)) {
    usage();
    if (sub && !["--help", "-h"].includes(sub)) process.exitCode = 1;
    return;
  }

  const source = flag(args, "registry") ?? (await defaultRegistry());
  if (!source) {
    console.error("I do not know which registry to use. Pass `--registry <path|url>`, or sign in with `cortex auth login` so the server can say.");
    process.exitCode = 1;
    return;
  }

  let manifest;
  try {
    manifest = await loadRegistry(source);
  } catch (e) {
    console.error(`✗ ${(e as Error).message}`);
    process.exitCode = 1;
    return;
  }

  const total = Object.keys(manifest.mcpServers).length + manifest.skills.length + manifest.commands.length;
  console.log(`registry: ${source}  ·  ${total} entr${total === 1 ? "y" : "ies"}`);

  if (sub === "doctor") {
    console.log("\nWhat each entry needs to authenticate (nothing is installed):");
    const rows = auditToolbelt(manifest);
    if (rows.length === 0) console.log("  (the registry is empty)");
    for (const r of rows) console.log(`  ${r.ok ? "✔" : "✗"} ${r.line}`);
    if (rows.some((r) => !r.ok)) {
      console.log("\nEntries with missing variables are skipped on install: a broken MCP is worse than none.");
      process.exitCode = 1;
    }
    return;
  }

  const apply = args.includes("--apply");
  const ctx = defaultCtx({ dryRun: !apply });
  const repo = flag(args, "repo") ?? null;
  const pedidos = flag(args, "agents")?.split(",").map((s) => s.trim()) as AgentId[] | undefined;
  const agents = pedidos ?? detectAgents(ctx);
  if (agents.length === 0) {
    console.log("No coding agents found on this machine.");
    return;
  }

  console.log(apply ? "" : "(dry run — use --apply to write)");
  let cambios = 0;
  for (const agent of agents) {
    const report = installToolbelt(ctx, agent, manifest, repo);
    console.log(`\n[${agent}]`);
    for (const c of report.changed) {
      console.log(`  ${apply ? "✓" : "•"} ${c}`);
      cambios++;
    }
    for (const s of report.skipped) console.log(`  · ${s}`);
    for (const w of report.warnings) console.log(`  ⚠️  ${w}`);
    if (!report.changed.length && !report.skipped.length && !report.warnings.length) console.log("  · nothing for this agent");
  }

  if (!apply) console.log("\nThat was a dry run. Run it again with --apply to write.");
  else if (cambios) console.log("\nDone. Restart your agents so they pick up the new configuration.");
  else console.log("\nEverything was already in place.");
}

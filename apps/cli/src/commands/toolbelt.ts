import { defaultCtx, detectAgents, type AgentId } from "../setup/index.js";
import { auditToolbelt, installToolbelt } from "../toolbelt/install.js";
import { loadRegistry } from "../toolbelt/registry.js";
import { getClientConfig, readCredentials } from "@cortex/client";

/**
 * `cortex toolbelt` — instala el toolbelt de TU organización (MCPs, skills y comandos de las
 * herramientas que use tu equipo) en los agentes de este equipo.
 *
 * No es lo mismo que `cortex setup`: eso instala Cortex. Esto instala lo demás, y por eso el
 * registry vive fuera de este repo, normalmente en uno privado (ADR-0014 revisado, ADR-0026).
 *
 *   cortex toolbelt sync --registry <ruta|url> [--repo <dir>] [--agents a,b] [--apply]
 *   cortex toolbelt doctor --registry <ruta|url>
 *
 * DRY-RUN por defecto: sin `--apply` solo cuenta lo que haría.
 */

function usage(): void {
  console.log("Uso: cortex toolbelt sync [--registry <ruta|url>] [--repo <dir>] [--agents a,b] [--apply]");
  console.log("     cortex toolbelt doctor [--registry <ruta|url>]\n");
  console.log("  --registry  el registry de tu organización (por defecto, el que sirva tu servidor)");
  console.log("  --repo      checkout local del registry: hace falta para skills, comandos y rutas {REPO}");
  console.log("  --agents    limita a estos agentes (por defecto, los detectados)");
  console.log("  --apply     escribe de verdad (sin esto es un simulacro)\n");
  console.log("Para instalar Cortex en tus agentes es otro comando: `cortex setup --all`.");
}

function flag(args: string[], name: string): string | undefined {
  const i = args.indexOf(`--${name}`);
  if (i >= 0 && args[i + 1] && !args[i + 1]!.startsWith("--")) return args[i + 1];
  return args.find((a) => a.startsWith(`--${name}=`))?.split("=").slice(1).join("=");
}

/** Sin `--registry`, se le pregunta al servidor: es quien sabe cuál usa el equipo. */
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
    console.error("No sé qué registry usar. Pasa `--registry <ruta|url>`, o inicia sesión con `cortex auth login` para que lo diga el servidor.");
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
  console.log(`registry: ${source}  ·  ${total} entrada(s)`);

  if (sub === "doctor") {
    console.log("\nQué auth necesita cada cosa (no instalo nada):");
    const rows = auditToolbelt(manifest);
    if (rows.length === 0) console.log("  (el registry está vacío)");
    for (const r of rows) console.log(`  ${r.ok ? "✔" : "✗"} ${r.line}`);
    if (rows.some((r) => !r.ok)) {
      console.log("\nLas entradas con variables sin exportar se omiten al instalar: no se registra un MCP roto.");
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
    console.log("No he detectado ningún agente en este equipo.");
    return;
  }

  console.log(apply ? "" : "(simulacro — usa --apply para escribir)");
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
    if (!report.changed.length && !report.skipped.length && !report.warnings.length) console.log("  · nada para este agente");
  }

  if (!apply) console.log("\nEsto era un simulacro. Repite con --apply para aplicarlo.");
  else if (cambios) console.log("\nListo. Reinicia tus agentes para que carguen la configuración nueva.");
  else console.log("\nTodo estaba ya en su sitio.");
}

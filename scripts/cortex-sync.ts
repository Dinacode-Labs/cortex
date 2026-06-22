/**
 * cortex sync — instalador del harness de IA de Cortex en los agentes del usuario.
 *
 * Detecta Claude Code / Codex / OpenCode instalados y registra en cada uno:
 *  - el servidor MCP `cortex`,
 *  - la skill `cortex-capture` y el comando `/cortex-save`.
 *
 * Fuente única: config/ (mcp, skills, commands). Idempotente.
 * DRY-RUN por defecto (no escribe nada). Usa --apply para aplicar.
 *
 * Uso: pnpm cortex:sync [--apply] [--agents claude,codex,opencode]
 */
import { execSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, symlinkSync, rmSync, writeFileSync, readdirSync } from "node:fs";
import { homedir } from "node:os";
import { resolve, join, basename } from "node:path";

const REPO = resolve(import.meta.dirname, "..");
const HOME = homedir();
const SKILLS = join(REPO, "config/skills");
const COMMANDS = join(REPO, "config/commands");
const MCP_CMD = "pnpm";
const MCP_ARGS = ["-C", REPO, "--filter", "@cortex/mcp-server", "start"];

const argv = process.argv.slice(2);
const APPLY = argv.includes("--apply");
const agentsArg = argv.find((a) => a.startsWith("--agents="))?.split("=")[1]
  ?? (argv.includes("--agents") ? argv[argv.indexOf("--agents") + 1] : undefined);

function have(bin: string): boolean {
  try {
    execSync(`command -v ${bin}`, { stdio: "ignore" });
    return true;
  } catch {
    return false;
  }
}

const steps: string[] = [];
function plan(msg: string) {
  steps.push(msg);
  console.log(`  ${APPLY ? "✓" : "•"} ${msg}`);
}

function linkInto(dirSrc: string, destDir: string) {
  for (const name of readdirSync(dirSrc)) {
    const src = join(dirSrc, name);
    const dest = join(destDir, name);
    plan(`symlink ${dest} → ${src}`);
    if (APPLY) {
      mkdirSync(destDir, { recursive: true });
      try { rmSync(dest, { recursive: true, force: true }); } catch {}
      symlinkSync(src, dest);
    }
  }
}

// --- Claude Code -------------------------------------------------------------
function syncClaude() {
  console.log("\n[Claude Code]");
  plan(`claude mcp add cortex -s user -- ${MCP_CMD} ${MCP_ARGS.join(" ")}`);
  if (APPLY) {
    try { execSync("claude mcp remove cortex -s user", { stdio: "ignore" }); } catch {}
    execSync(`claude mcp add cortex -s user -- ${MCP_CMD} ${MCP_ARGS.join(" ")}`, { stdio: "ignore" });
  }
  linkInto(SKILLS, join(HOME, ".claude/skills"));
  linkInto(COMMANDS, join(HOME, ".claude/commands"));
}

// --- Codex -------------------------------------------------------------------
function syncCodex() {
  console.log("\n[Codex]");
  const toml = join(HOME, ".codex/config.toml");
  const block = `\n[mcp_servers.cortex]\ncommand = "${MCP_CMD}"\nargs = [${MCP_ARGS.map((a) => `"${a}"`).join(", ")}]\n`;
  const has = existsSync(toml) && readFileSync(toml, "utf8").includes("[mcp_servers.cortex]");
  plan(has ? `MCP cortex ya presente en ${toml}` : `añadir [mcp_servers.cortex] a ${toml}`);
  if (APPLY && !has) {
    mkdirSync(join(HOME, ".codex"), { recursive: true });
    writeFileSync(toml, (existsSync(toml) ? readFileSync(toml, "utf8") : "") + block);
  }
  // Comando como prompt de Codex.
  plan(`symlink ${join(HOME, ".codex/prompts/cortex-save.md")} → ${join(COMMANDS, "cortex-save.md")}`);
  if (APPLY) {
    mkdirSync(join(HOME, ".codex/prompts"), { recursive: true });
    const dest = join(HOME, ".codex/prompts/cortex-save.md");
    try { rmSync(dest, { force: true }); } catch {}
    symlinkSync(join(COMMANDS, "cortex-save.md"), dest);
  }
}

// --- OpenCode ----------------------------------------------------------------
function syncOpenCode() {
  console.log("\n[OpenCode]");
  const cfg = join(HOME, ".config/opencode/opencode.json");
  plan(`registrar MCP cortex (local) en ${cfg}`);
  if (APPLY) {
    let obj: Record<string, unknown> = {};
    if (existsSync(cfg)) {
      try { obj = JSON.parse(readFileSync(cfg, "utf8")); } catch {
        console.log("    ⚠️ no pude parsear opencode.json (¿jsonc?); añade el MCP a mano. Snippet:");
        console.log(`    "mcp": { "cortex": { "type": "local", "command": ["${MCP_CMD}", ${MCP_ARGS.map((a) => `"${a}"`).join(", ")}], "enabled": true } }`);
        return;
      }
    }
    const mcp = (obj.mcp as Record<string, unknown>) ?? {};
    mcp.cortex = { type: "local", command: [MCP_CMD, ...MCP_ARGS], enabled: true };
    obj.mcp = mcp;
    if (!obj.$schema) obj.$schema = "https://opencode.ai/config.json";
    mkdirSync(join(HOME, ".config/opencode"), { recursive: true });
    writeFileSync(cfg, JSON.stringify(obj, null, 2) + "\n");
  }
  plan(`symlink ${join(HOME, ".config/opencode/command/cortex-save.md")} → ${join(COMMANDS, "cortex-save.md")}`);
  if (APPLY) {
    const dest = join(HOME, ".config/opencode/command/cortex-save.md");
    mkdirSync(join(HOME, ".config/opencode/command"), { recursive: true });
    try { rmSync(dest, { force: true }); } catch {}
    symlinkSync(join(COMMANDS, "cortex-save.md"), dest);
  }
}

// --- main --------------------------------------------------------------------
const KNOWN: Record<string, { bin: string; run: () => void }> = {
  claude: { bin: "claude", run: syncClaude },
  codex: { bin: "codex", run: syncCodex },
  opencode: { bin: "opencode", run: syncOpenCode },
};

const requested = agentsArg ? agentsArg.split(",").map((s) => s.trim()) : Object.keys(KNOWN);

console.log(`cortex sync ${APPLY ? "(APLICAR)" : "(dry-run — usa --apply para escribir)"}`);
console.log(`repo: ${REPO}`);
console.log(`harness: ${basename(SKILLS)}/cortex-capture, ${basename(COMMANDS)}/cortex-save.md, MCP cortex`);

let any = false;
for (const name of requested) {
  const a = KNOWN[name];
  if (!a) { console.log(`\n[${name}] desconocido (usa: ${Object.keys(KNOWN).join(", ")})`); continue; }
  if (!have(a.bin)) { console.log(`\n[${name}] no detectado (no está '${a.bin}' en PATH) — omitido`); continue; }
  any = true;
  a.run();
}

if (!any) console.log("\nNingún agente detectado. Instala claude/codex/opencode o usa --agents.");
console.log(`\n${steps.length} acciones ${APPLY ? "aplicadas" : "planificadas"}.${APPLY ? "" : " Revisa y vuelve a ejecutar con --apply."}`);

/**
 * cortex sync — instalador del toolbelt de IA de Dinacode en los agentes del dev.
 *
 * Lee el registry `config/toolbelt.json` (MCPs + skills + comandos) e instala/
 * actualiza cada uno en los agentes detectados (Claude Code / Codex / OpenCode).
 * El registry es PR-able: añade/mejora una skill o MCP con un PR y `cortex sync`
 * la reparte. Cortex reparte CONFIGURACIÓN, nunca credenciales: cada tool conserva
 * su auth (el dev la configura; `--doctor` indica qué falta).
 *
 * Uso:
 *   pnpm cortex:sync [--apply] [--agents claude,codex,opencode]
 *   pnpm cortex:sync --doctor        # estado de auth por tool, no instala
 *
 * DRY-RUN por defecto. Las skills se enlazan por symlink: un `git pull` ya las
 * actualiza; re-ejecuta con --apply para re-registrar MCPs/comandos.
 */
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join, resolve } from "node:path";

const REPO = resolve(import.meta.dirname, "..");
const HOME = homedir();
const TOOLBELT = JSON.parse(readFileSync(join(REPO, "config/toolbelt.json"), "utf8")) as Manifest;

interface McpDef {
  transport: "stdio" | "http";
  command?: string;
  args?: string[];
  url?: string;
  env?: string[];
  auth?: string;
  agents?: string[];
}
interface Manifest {
  mcpServers: Record<string, McpDef>;
  skills: { name: string; auth?: string }[];
  commands: { name: string; file: string }[];
}

const argv = process.argv.slice(2);
const APPLY = argv.includes("--apply");
const DOCTOR = argv.includes("--doctor");
const agentsArg = argv.find((a) => a.startsWith("--agents="))?.split("=")[1]
  ?? (argv.includes("--agents") ? argv[argv.indexOf("--agents") + 1] : undefined);

const AGENT_BIN: Record<string, string> = { claude: "claude", codex: "codex", opencode: "opencode" };
const resolveArgs = (a: string[] = []) => a.map((x) => x.replace("{REPO}", REPO));
const envPairs = (keys: string[] = []) => keys.filter((k) => process.env[k]).map((k) => [k, process.env[k]!] as const);

function have(bin: string): boolean {
  try { execFileSync("/bin/sh", ["-c", `command -v ${bin}`], { stdio: "ignore" }); return true; } catch { return false; }
}
function plan(msg: string) { console.log(`  ${APPLY ? "✓" : "•"} ${msg}`); }
function symlink(src: string, dest: string) {
  plan(`symlink ${dest.replace(HOME, "~")} → ${src.replace(REPO, ".")}`);
  if (!APPLY) return;
  mkdirSync(join(dest, ".."), { recursive: true });
  try { rmSync(dest, { recursive: true, force: true }); } catch {}
  symlinkSync(src, dest);
}

// --- registro de MCP por agente ---------------------------------------------
function claudeHas(name: string): boolean {
  try { execFileSync("claude", ["mcp", "get", name], { stdio: "ignore" }); return true; } catch { return false; }
}
function mcpClaude(name: string, d: McpDef) {
  if (claudeHas(name)) { plan(`${name} ya registrado — preservado (no toco su auth)`); return; }
  if (d.transport === "http") {
    plan(`claude mcp add --transport http ${name} ${d.url}`);
    if (APPLY) execFileSync("claude", ["mcp", "add", "--transport", "http", name, d.url!, "-s", "user"], { stdio: "ignore" });
    return;
  }
  const envs = envPairs(d.env);
  const eFlags = envs.flatMap(([k, v]) => ["-e", `${k}=${v}`]);
  const missing = (d.env ?? []).filter((k) => !process.env[k]);
  plan(`claude mcp add ${name} -s user ${envs.map(([k]) => `-e ${k}`).join(" ")} -- ${d.command} ${resolveArgs(d.args).join(" ")}`.replace(/\s+/g, " ") + (missing.length ? `   ⚠️ falta env: ${missing.join(",")}` : ""));
  if (APPLY) execFileSync("claude", ["mcp", "add", name, "-s", "user", ...eFlags, "--", d.command!, ...resolveArgs(d.args)], { stdio: "ignore" });
}
function mcpCodex(name: string, d: McpDef) {
  if (d.transport !== "stdio") { plan(`(codex) ${name}: transporte http no soportado por el instalador — omitido`); return; }
  const toml = join(HOME, ".codex/config.toml");
  if (existsSync(toml) && readFileSync(toml, "utf8").includes(`[mcp_servers.${name}]`)) { plan(`(codex) ${name} ya presente en config.toml`); return; }
  const envs = envPairs(d.env);
  let block = `\n[mcp_servers.${name}]\ncommand = "${d.command}"\nargs = [${resolveArgs(d.args).map((a) => `"${a}"`).join(", ")}]\n`;
  if (envs.length) block += `env = { ${envs.map(([k, v]) => `${k} = "${v}"`).join(", ")} }\n`;
  plan(`(codex) añadir [mcp_servers.${name}] a config.toml`);
  if (APPLY) { mkdirSync(join(HOME, ".codex"), { recursive: true });
    writeFileSync(toml, (existsSync(toml) ? readFileSync(toml, "utf8") : "") + block); }
}
function mcpOpenCode(name: string, d: McpDef) {
  const cfg = join(HOME, ".config/opencode/opencode.json");
  let obj: Record<string, any> = {};
  if (existsSync(cfg)) { try { obj = JSON.parse(readFileSync(cfg, "utf8")); } catch { plan(`${name}: opencode.json no parseable — configúralo a mano`); return; } }
  if (obj.mcp?.[name]) { plan(`${name} ya presente — preservado`); return; }
  plan(`(opencode) registrar mcp.${name} en opencode.json`);
  if (!APPLY) return;
  obj.$schema ??= "https://opencode.ai/config.json";
  obj.mcp ??= {};
  obj.mcp[name] = d.transport === "http"
    ? { type: "remote", url: d.url, enabled: true }
    : { type: "local", command: [d.command, ...resolveArgs(d.args)], enabled: true, ...(envPairs(d.env).length ? { environment: Object.fromEntries(envPairs(d.env)) } : {}) };
  mkdirSync(join(HOME, ".config/opencode"), { recursive: true });
  writeFileSync(cfg, JSON.stringify(obj, null, 2) + "\n");
}

// --- doctor ------------------------------------------------------------------
function doctor() {
  console.log("cortex doctor — estado de auth por tool (no instala nada)\n");
  console.log("[MCPs]");
  for (const [name, d] of Object.entries(TOOLBELT.mcpServers)) {
    if (d.transport === "http") { console.log(`  ${name}: auth interactiva — ${d.auth}`); continue; }
    const need = d.env ?? [];
    const missing = need.filter((k) => !process.env[k]);
    const ok = missing.length === 0;
    console.log(`  ${ok ? "✔" : "✗"} ${name}: ${need.length ? `env ${need.join(",")}` : "sin env"}${missing.length ? ` — FALTAN: ${missing.join(",")}` : ""}  (${d.auth})`);
  }
  console.log("\n[Skills] (auth la configura el dev)");
  for (const s of TOOLBELT.skills) console.log(`  • ${s.name}: ${s.auth ?? "—"}`);
}

// --- main --------------------------------------------------------------------
if (DOCTOR) { doctor(); process.exit(0); }

const requested = agentsArg ? agentsArg.split(",").map((s) => s.trim()) : Object.keys(AGENT_BIN);
console.log(`cortex sync ${APPLY ? "(APLICAR)" : "(dry-run — usa --apply para escribir)"}  ·  repo: ${REPO}`);

for (const agent of requested) {
  const bin = AGENT_BIN[agent];
  if (!bin) { console.log(`\n[${agent}] desconocido`); continue; }
  if (!have(bin)) { console.log(`\n[${agent}] no detectado — omitido`); continue; }
  console.log(`\n[${agent}]`);

  for (const [name, d] of Object.entries(TOOLBELT.mcpServers)) {
    if (d.agents && !d.agents.includes(agent)) continue;
    const missing = (d.env ?? []).filter((k) => !process.env[k]);
    if (missing.length) { plan(`${name}: requiere env ${missing.join(",")} — omitido (expórtalas y re-ejecuta)`); continue; }
    if (agent === "claude") mcpClaude(name, d);
    else if (agent === "codex") mcpCodex(name, d);
    else if (agent === "opencode") mcpOpenCode(name, d);
  }

  // Skills: SKILL.md es nativo en Claude; otros agentes usan MCP + comandos.
  if (agent === "claude") {
    for (const s of TOOLBELT.skills) {
      const src = join(REPO, "config/skills", s.name);
      if (existsSync(src)) symlink(src, join(HOME, ".claude/skills", s.name));
    }
  }

  // Comandos / prompts.
  const cmdDest: Record<string, string> = {
    claude: join(HOME, ".claude/commands"),
    codex: join(HOME, ".codex/prompts"),
    opencode: join(HOME, ".config/opencode/command"),
  };
  for (const c of TOOLBELT.commands) symlink(join(REPO, "config/commands", c.file), join(cmdDest[agent]!, c.file));
}

console.log(`\n${APPLY ? "Aplicado" : "Plan listo"}. Auth por tool: \`pnpm cortex:sync --doctor\`. ${APPLY ? "" : "Re-ejecuta con --apply para escribir."}`);

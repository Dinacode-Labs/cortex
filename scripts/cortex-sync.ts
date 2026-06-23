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
import { parse as yamlParse, stringify as yamlStringify } from "yaml";

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

const AGENT_BIN: Record<string, string> = { claude: "claude", codex: "codex", opencode: "opencode", hermes: "hermes" };
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

function mcpHermes(name: string, d: McpDef) {
  // Hermes Agent (Nous Research) lee mcp_servers de ~/.hermes/config.yaml (YAML).
  const cfg = join(HOME, ".hermes/config.yaml");
  let obj: Record<string, any> = {};
  if (existsSync(cfg)) {
    try { obj = (yamlParse(readFileSync(cfg, "utf8")) as Record<string, any>) ?? {}; }
    catch { plan(`${name}: ~/.hermes/config.yaml no parseable — configúralo a mano`); return; }
  }
  obj.mcp_servers ??= {};
  if (obj.mcp_servers[name]) { plan(`${name} ya presente — preservado`); return; }
  plan(`(hermes) añadir mcp_servers.${name} a ~/.hermes/config.yaml`);
  if (!APPLY) return;
  obj.mcp_servers[name] = d.transport === "http"
    ? { url: d.url, enabled: true }
    : { command: d.command, args: resolveArgs(d.args), enabled: true, ...(envPairs(d.env).length ? { env: Object.fromEntries(envPairs(d.env)) } : {}) };
  mkdirSync(join(HOME, ".hermes"), { recursive: true });
  writeFileSync(cfg, yamlStringify(obj));
}

// --- hooks de Claude Code (auto-inyección de contexto + auto-captura) --------
function syncClaudeHooks() {
  const file = join(HOME, ".claude/settings.json");
  let obj: Record<string, any> = {};
  if (existsSync(file)) {
    try { obj = JSON.parse(readFileSync(file, "utf8")); } catch { plan("hooks: ~/.claude/settings.json no parseable — configúralo a mano"); return; }
  }
  obj.hooks ??= {};
  const defs = [
    { event: "SessionStart", marker: "hook:context", cmd: `pnpm -C ${REPO} --filter @cortex/core run hook:context` },
    { event: "SessionEnd", marker: "hook:capture", cmd: `pnpm -C ${REPO} --filter @cortex/agents run hook:capture` },
  ];
  let changed = false;
  for (const d of defs) {
    const arr = (obj.hooks[d.event] ??= []) as { hooks?: { command?: string }[] }[];
    const present = arr.some((g) => (g.hooks ?? []).some((h) => typeof h.command === "string" && h.command.includes(d.marker)));
    if (present) { plan(`hook ${d.event} (cortex) ya presente — preservado`); continue; }
    plan(`hook ${d.event} → cortex ${d.marker}`);
    if (APPLY) { arr.push({ hooks: [{ type: "command", command: d.cmd }] } as never); changed = true; }
  }
  if (APPLY && changed) {
    mkdirSync(join(HOME, ".claude"), { recursive: true });
    writeFileSync(file, JSON.stringify(obj, null, 2) + "\n");
  }
}

const HOOK_CTX = `pnpm -C ${REPO} --filter @cortex/core run hook:context`;

/** Codex: hook SessionStart (mismo formato additionalContext que Claude) en config.toml. */
function syncCodexHooks() {
  const toml = join(HOME, ".codex/config.toml");
  if (existsSync(toml) && readFileSync(toml, "utf8").includes("hook:context")) { plan("hook SessionStart (cortex) ya presente en config.toml"); return; }
  plan(`(codex) hook SessionStart → cortex hook:context`);
  if (!APPLY) return;
  const block = `\n[[hooks.SessionStart]]\n\n[[hooks.SessionStart.hooks]]\ntype = "command"\ncommand = "${HOOK_CTX}"\n`;
  mkdirSync(join(HOME, ".codex"), { recursive: true });
  writeFileSync(toml, (existsSync(toml) ? readFileSync(toml, "utf8") : "") + block);
}

/** Hermes: hook pre_llm_call (inyecta {"context":...}) en ~/.hermes/config.yaml. */
function syncHermesHooks() {
  const cfg = join(HOME, ".hermes/config.yaml");
  let obj: Record<string, any> = {};
  if (existsSync(cfg)) {
    try { obj = (yamlParse(readFileSync(cfg, "utf8")) as Record<string, any>) ?? {}; } catch { plan("hooks: ~/.hermes/config.yaml no parseable — a mano"); return; }
  }
  obj.hooks ??= {};
  const arr = (obj.hooks.pre_llm_call ??= []) as { command?: string }[];
  if (arr.some((h) => typeof h.command === "string" && h.command.includes("hook:context"))) { plan("(hermes) hook pre_llm_call (cortex) ya presente"); return; }
  plan(`(hermes) hook pre_llm_call → cortex hook:context (formato hermes)`);
  if (!APPLY) return;
  arr.push({ command: `${HOOK_CTX} -- --format hermes` } as never);
  mkdirSync(join(HOME, ".hermes"), { recursive: true });
  writeFileSync(cfg, yamlStringify(obj));
}

/** OpenCode: plugin TS que al crear sesión inyecta el context-pack (shell-out al script). */
function syncOpenCodeHooks() {
  const dir = join(HOME, ".config/opencode/plugin");
  const file = join(dir, "cortex.js");
  plan(`(opencode) plugin cortex.js → inyecta context-pack en session.created`);
  if (!APPLY) return;
  const plugin = `// Generado por 'cortex sync'. Inyecta el context-pack de Cortex al crear sesión.
export const CortexPlugin = async ({ $, directory }) => {
  let pending = null;
  return {
    event: async ({ event }) => {
      try {
        if (event.type === "session.created") {
          const r = await $\`${HOOK_CTX} -- --format text --cwd \${directory}\`.quiet().nothrow();
          if (r.exitCode === 0) { const t = r.stdout.toString().trim(); if (t) pending = t; }
        }
      } catch {}
    },
    "chat.message": async (_input, output) => {
      if (pending) { output.parts.push({ type: "text", text: pending }); pending = null; }
    },
  };
};
`;
  mkdirSync(dir, { recursive: true });
  writeFileSync(file, plugin);
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
    else if (agent === "hermes") mcpHermes(name, d);
  }

  // Skills: SKILL.md es nativo en Claude; otros agentes usan MCP + comandos.
  if (agent === "claude") {
    for (const s of TOOLBELT.skills) {
      const src = join(REPO, "config/skills", s.name);
      if (existsSync(src)) symlink(src, join(HOME, ".claude/skills", s.name));
    }
    // Hooks: auto-inyección de context-pack (SessionStart) + auto-captura (SessionEnd).
    syncClaudeHooks();
  }

  // Comandos / prompts (los agentes que tienen carpeta de comandos).
  const cmdDest: Record<string, string> = {
    claude: join(HOME, ".claude/commands"),
    codex: join(HOME, ".codex/prompts"),
    opencode: join(HOME, ".config/opencode/command"),
  };
  const dest = cmdDest[agent];
  if (dest) for (const c of TOOLBELT.commands) symlink(join(REPO, "config/commands", c.file), join(dest, c.file));

  // Hooks: inyección de context-pack (todos) + auto-captura (Claude). Adaptador por agente.
  if (agent === "codex") syncCodexHooks();
  else if (agent === "opencode") syncOpenCodeHooks();
  else if (agent === "hermes") syncHermesHooks();
}

console.log(`\n${APPLY ? "Aplicado" : "Plan listo"}. Auth por tool: \`pnpm cortex:sync --doctor\`. ${APPLY ? "" : "Re-ejecuta con --apply para escribir."}`);

import { parse as yamlParse, stringify as yamlStringify } from "yaml";
import { mkdirSync, rmSync, symlinkSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { backupOnce, homeFile, readJson, readText, tilde, writeText } from "../setup/fs.js";
import { emptyReport, type AgentId, type SetupCtx, type SetupReport } from "../setup/types.js";
import { missingEnv, resolveArgs, type Manifest, type McpDef } from "./registry.js";

/**
 * Installs an organisation's registry into the dev's agents.
 *
 * Each agent registers its MCPs its own way: Claude and Codex have their own command, and
 * OpenCode, Hermes and Pi declare it in a config file. Only third-party MCPs are registered
 * here, and skills and commands linked; the hooks and Cortex's own MCP are `cortex setup`'s job
 * (ADR-0032), which is what separates "the product" from "your company's tools".
 *
 * The rule that does not bend: configuration is distributed, credentials never are. An entry
 * whose variables are not exported is skipped with a warning; no value is invented and no MCP
 * is left registered and broken.
 */

const envPairs = (d: McpDef): string[][] => (d.env ?? []).filter((k) => process.env[k]).map((k) => [k, process.env[k]!]);

interface JsonMcpFile {
  mcpServers?: Record<string, unknown>;
  mcp?: Record<string, unknown>;
  [k: string]: unknown;
}

/** Writes an entry into a config JSON file, respecting whatever was already there. */
function upsertJsonMcp(ctx: SetupCtx, file: string, key: "mcpServers" | "mcp", name: string, value: unknown, report: SetupReport): void {
  const cfg = readJson<JsonMcpFile>(file);
  if (cfg === null) {
    report.warnings.push(`${tilde(ctx, file)} is not valid JSON — ${name} not installed`);
    return;
  }
  const conf: JsonMcpFile = cfg ?? {};
  const bag = (conf[key] ??= {}) as Record<string, unknown>;
  if (bag[name]) {
    report.skipped.push(`${name}: already there — left alone (it may already be authenticated)`);
    return;
  }
  bag[name] = value;
  backupOnce(ctx, file);
  writeText(ctx, file, JSON.stringify(conf, null, 2) + "\n");
  report.changed.push(`${name} → ${tilde(ctx, file)}`);
}

function upsertYamlMcp(ctx: SetupCtx, file: string, name: string, value: unknown, report: SetupReport): void {
  const raw = readText(file);
  let cfg: Record<string, any>;
  try {
    cfg = raw === null ? {} : ((yamlParse(raw) as Record<string, any>) ?? {});
  } catch {
    report.warnings.push(`${tilde(ctx, file)} is not valid YAML — ${name} not installed`);
    return;
  }
  cfg.mcp_servers ??= {};
  if (cfg.mcp_servers[name]) {
    report.skipped.push(`${name}: already there — left alone`);
    return;
  }
  cfg.mcp_servers[name] = value;
  backupOnce(ctx, file);
  writeText(ctx, file, yamlStringify(cfg));
  report.changed.push(`${name} → ${tilde(ctx, file)}`);
}

/** Registers an MCP through the agent's CLI (Claude and Codex have one). */
function registerViaCli(ctx: SetupCtx, bin: string, name: string, d: McpDef, args: string[], report: SetupReport): void {
  const exists = (): boolean => {
    try {
      ctx.exec(bin, ["mcp", "get", name]);
      return true;
    } catch {
      return false;
    }
  };
  if (!ctx.dryRun && exists()) {
    report.skipped.push(`${name}: already registered — left alone (it may already be authenticated)`);
    return;
  }
  const scope = bin === "claude" ? ["-s", "user"] : [];
  const envFlags = envPairs(d).flatMap(([k, v]) => (bin === "claude" ? ["-e", `${k}=${v}`] : ["--env", `${k}=${v}`]));
  const cmd =
    d.transport === "http"
      ? bin === "claude"
        ? ["mcp", "add", "--transport", "http", name, d.url!, ...scope]
        : ["mcp", "add", name, "--url", d.url!]
      : ["mcp", "add", name, ...scope, ...envFlags, "--", d.command!, ...args];
  report.changed.push(`${name} → ${bin} ${cmd.slice(0, 3).join(" ")}…`);
  if (ctx.dryRun) return;
  try {
    ctx.exec(bin, cmd);
  } catch (e) {
    report.warnings.push(`${name}: could not register it in ${bin} (${(e as Error).message.split("\n")[0]})`);
  }
}

function link(ctx: SetupCtx, src: string, dest: string, report: SetupReport): void {
  report.changed.push(`${tilde(ctx, dest)} → ${src}`);
  if (ctx.dryRun) return;
  mkdirSync(dirname(dest), { recursive: true });
  try {
    rmSync(dest, { recursive: true, force: true });
  } catch {
    /* there was nothing */
  }
  symlinkSync(src, dest);
}

/**
 * Installs the registry into one agent. `repo` is the registry's local checkout: without it,
 * only the MCPs that do not depend on a path are installed, and skills and commands are skipped
 * (they are files, and with no repo there is nowhere to take them from).
 */
export function installToolbelt(ctx: SetupCtx, agent: AgentId, manifest: Manifest, repo: string | null): SetupReport {
  const report = emptyReport();
  const agentKey = agent === "claude-code" ? "claude" : agent;

  for (const [name, d] of Object.entries(manifest.mcpServers)) {
    if (d.agents && !d.agents.includes(agentKey)) continue;
    const missing = missingEnv(d);
    if (missing.length) {
      report.warnings.push(`${name}: skipped, missing variables (${missing.join(", ")}). Export them and run it again.`);
      continue;
    }
    const args = resolveArgs(d.args, repo);
    if (args === null) {
      report.warnings.push(`${name}: skipped, its command uses {REPO} and you did not pass --repo`);
      continue;
    }
    switch (agent) {
      case "claude-code":
        registerViaCli(ctx, "claude", name, d, args, report);
        break;
      case "codex":
        registerViaCli(ctx, "codex", name, d, args, report);
        break;
      case "opencode":
        upsertJsonMcp(
          ctx,
          homeFile(ctx, ".config/opencode/opencode.json"),
          "mcp",
          name,
          d.transport === "http" ? { type: "remote", url: d.url, enabled: true } : { type: "local", command: [d.command!, ...args], enabled: true },
          report,
        );
        break;
      case "pi":
        if (d.transport === "http") report.warnings.push(`${name}: Pi does not support HTTP MCPs in mcp.json — skipped`);
        else upsertJsonMcp(ctx, homeFile(ctx, ".pi/agent/mcp.json"), "mcpServers", name, { command: d.command, args }, report);
        break;
      case "hermes":
        upsertYamlMcp(
          ctx,
          homeFile(ctx, ".hermes/config.yaml"),
          name,
          d.transport === "http" ? { url: d.url, enabled: true } : { command: d.command, args, enabled: true },
          report,
        );
        break;
    }
  }

  if (!repo) {
    if (manifest.skills.length || manifest.commands.length) {
      report.warnings.push("skills and commands skipped: they are files, and need --repo <checkout of the registry>");
    }
    return report;
  }

  // Only Claude Code has native skills; the rest use the tools over MCP.
  if (agent === "claude-code") {
    for (const s of manifest.skills) link(ctx, resolve(repo, "skills", s.name), homeFile(ctx, ".claude/skills", s.name), report);
  }
  const commandsDir: Partial<Record<AgentId, string>> = {
    "claude-code": ".claude/commands",
    codex: ".codex/prompts",
    opencode: ".config/opencode/command",
  };
  const dir = commandsDir[agent];
  if (dir) for (const c of manifest.commands) link(ctx, resolve(repo, "commands", c.file), homeFile(ctx, dir, c.file), report);

  return report;
}

/** Which auth each entry needs and what is missing. It installs nothing. */
export function auditToolbelt(manifest: Manifest): { line: string; ok: boolean }[] {
  const out: { line: string; ok: boolean }[] = [];
  for (const [name, d] of Object.entries(manifest.mcpServers)) {
    if (d.transport === "http") {
      out.push({ line: `${name}: interactive auth — ${d.auth ?? "—"}`, ok: true });
      continue;
    }
    const missing = missingEnv(d);
    const need = d.env ?? [];
    out.push({
      line: `${name}: ${need.length ? `env ${need.join(", ")}` : "no env vars"}${missing.length ? ` — MISSING: ${missing.join(", ")}` : ""}  (${d.auth ?? "—"})`,
      ok: missing.length === 0,
    });
  }
  for (const s of manifest.skills) out.push({ line: `skill ${s.name}: ${s.auth ?? "—"}`, ok: true });
  return out;
}


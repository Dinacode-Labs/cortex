import { parse as yamlParse, stringify as yamlStringify } from "yaml";
import { existsSync } from "node:fs";
import { backupOnce, homeFile, readText, tilde, writeText } from "./fs.js";
import { emptyReport, type AgentAdapter, type AgentStatus, type SetupCtx, type SetupReport } from "./types.js";

/**
 * Hermes (Nous Research). Everything lives in a single `~/.hermes/config.yaml`: the MCP under
 * `mcp_servers` and the hooks under `hooks`, with one array per event.
 *
 * Two warnings we cannot resolve on the user's behalf, which is why they are said out loud:
 * Hermes asks for explicit consent to run shell hooks (it has to be accepted inside Hermes, its
 * allowlist cannot be written from outside), and reading its sessions needs `node:sqlite`, that
 * is Node >= 22.5.
 *
 * `pre_llm_call` is kept as the injection event because it is the one Hermes has for that; what
 * is retired is the old version of the command, the one pointing at the cloned repo.
 */

const CONFIG = (ctx: SetupCtx): string => homeFile(ctx, ".hermes/config.yaml");

const CONTEXT_CMD = "cortex hook-context --format hermes";
const CAPTURE_CMD = "cortex hook-capture --platform hermes";

interface HermesConfig {
  mcp_servers?: Record<string, { command?: string; args?: string[]; url?: string; enabled?: boolean }>;
  hooks?: Record<string, { command?: string }[]>;
  [k: string]: unknown;
}

/** `null` = it exists but does not parse (leave it alone); `{}` = it does not exist yet. */
function read(ctx: SetupCtx): HermesConfig | null {
  const raw = readText(CONFIG(ctx));
  if (raw === null) return {};
  try {
    return (yamlParse(raw) as HermesConfig) ?? {};
  } catch {
    return null;
  }
}

function write(ctx: SetupCtx, cfg: HermesConfig): void {
  backupOnce(ctx, CONFIG(ctx));
  writeText(ctx, CONFIG(ctx), yamlStringify(cfg));
}

const isCortex = (cmd: unknown): boolean => typeof cmd === "string" && /hook[-:](context|capture)/.test(cmd);

/** Installs or updates a Cortex hook on an event, without duplicating it or touching others. */
function upsertHook(cfg: HermesConfig, event: string, command: string): string | null {
  cfg.hooks ??= {};
  const arr = (cfg.hooks[event] ??= []);
  const mine = arr.filter((h) => isCortex(h.command));
  if (mine.length === 0) {
    arr.push({ command });
    return `hook ${event} → ${command}`;
  }
  const stale = mine.filter((h) => h.command !== command);
  if (stale.length === 0) return null;
  for (const h of stale) h.command = command;
  return `hook ${event} updated (it came from an older version)`;
}

export const hermesAdapter: AgentAdapter = {
  id: "hermes",
  bin: "hermes",

  async apply(ctx: SetupCtx): Promise<SetupReport> {
    const report = emptyReport();
    const cfg = read(ctx);
    if (!cfg) {
      report.warnings.push(`${tilde(ctx, CONFIG(ctx))} is not valid YAML, so it was left alone.`);
      return report;
    }
    cfg.mcp_servers ??= {};
    const want = { command: "cortex", args: ["mcp"], enabled: true };
    if (JSON.stringify(cfg.mcp_servers.cortex) === JSON.stringify(want)) {
      report.skipped.push("MCP `cortex` already declared");
    } else {
      if (cfg.mcp_servers.cortex?.command === "pnpm") report.changed.push("MCP `cortex` pointed at the cloned repo — re-declared");
      else report.changed.push("MCP `cortex` declared in config.yaml");
      cfg.mcp_servers.cortex = want;
    }

    for (const [event, cmd] of [
      ["pre_llm_call", CONTEXT_CMD],
      ["session_end", CAPTURE_CMD],
    ] as const) {
      const msg = upsertHook(cfg, event, cmd);
      if (msg) report.changed.push(msg);
    }

    if (report.changed.length) write(ctx, cfg);
    report.warnings.push("Hermes asks for permission before running shell hooks: accept it inside Hermes the first time (allowlist).");
    report.warnings.push("Capturing Hermes sessions reads its SQLite database, which needs Node 22.5 or newer.");
    return report;
  },

  async remove(ctx: SetupCtx): Promise<SetupReport> {
    const report = emptyReport();
    const cfg = read(ctx);
    if (!cfg || !existsSync(CONFIG(ctx))) return report;
    if (cfg.mcp_servers?.cortex) {
      delete cfg.mcp_servers.cortex;
      report.changed.push("MCP `cortex` removed from config.yaml");
    }
    for (const [event, hooks] of Object.entries(cfg.hooks ?? {})) {
      const kept = hooks.filter((h) => !isCortex(h.command));
      if (kept.length === hooks.length) continue;
      report.changed.push(`Cortex hooks removed from ${event}`);
      if (kept.length) cfg.hooks![event] = kept;
      else delete cfg.hooks![event];
    }
    if (report.changed.length) write(ctx, cfg);
    return report;
  },

  async status(ctx: SetupCtx): Promise<AgentStatus> {
    const cfg = read(ctx);
    if (!cfg) return { installed: false, details: ["config.yaml could not be parsed"] };
    const mcp = cfg.mcp_servers?.cortex;
    const hooks = Object.values(cfg.hooks ?? {}).flat().filter((h) => isCortex(h.command)).length;
    return {
      installed: hooks > 0,
      details: [
        !mcp ? "MCP not declared" : mcp.command === "cortex" ? "MCP `cortex mcp` declared" : "MCP with the OLD command",
        hooks ? `${hooks} Cortex hook(s)` : "no Cortex hooks",
      ],
    };
  },
};

import { lstatSync, readlinkSync, rmSync } from "node:fs";
import { homeFile, readJson, tilde, writeJson } from "./fs.js";
import { hasCortexHooks, mergeHooks, removeHooks, type HookDef, type HooksHolder } from "./hooks-json.js";
import { emptyReport, type AgentAdapter, type AgentStatus, type SetupCtx, type SetupReport } from "./types.js";

/**
 * Claude Code. The preferred route is the **plugin** (`plugin/claude-code/` in this very repo,
 * published as a marketplace): it brings hooks, MCP, skill and command in a single package, it
 * updates itself, and the user can see and disable it from `/plugin`.
 *
 * The plugin depends on Claude being able to clone the marketplace, and this repo is private:
 * if the dev has no access through `gh`/SSH, the installation fails. In that case it does not
 * abort -- it falls back to `settings.json` mode, which does the same by writing hooks by hand.
 * That is also what `--no-plugin` forces.
 *
 * In both modes the legacy is cleaned up: `pnpm -C <repo> cortex hook-*` hooks, the MCP
 * registered as `pnpm --filter @cortex/mcp-server` (it talked to Postgres directly and with no
 * permissions) and the skill/command symlinks that pointed at the clone.
 */

export const MARKETPLACE = "dinacode-cortex";
export const MARKETPLACE_SOURCE = "Dinacode-Labs/cortex";
export const PLUGIN = `cortex@${MARKETPLACE}`;

const HOOK_DEFS: HookDef[] = [
  { event: "SessionStart", kind: "context", matcher: "startup|resume|clear|compact", command: "cortex hook-context", timeout: 20 },
  { event: "SessionEnd", kind: "capture", command: "cortex hook-capture", timeout: 30 },
  { event: "PreCompact", kind: "capture", command: "cortex hook-capture", timeout: 30 },
];

const settingsFile = (ctx: SetupCtx): string => homeFile(ctx, ".claude/settings.json");

/** The `cortex` MCP's state in Claude: unregistered, correctly registered, or on the old command. */
function mcpState(ctx: SetupCtx): "missing" | "ok" | "legacy" {
  try {
    const out = ctx.exec("claude", ["mcp", "get", "cortex"]);
    return /^\s*Command:\s*cortex\s*$/m.test(out) ? "ok" : "legacy";
  } catch {
    return "missing";
  }
}

/** Symlinks `cortex sync` left pointing at the repo clone: the plugin provides them now. */
function dropLegacyLinks(ctx: SetupCtx, report: SetupReport): void {
  for (const rel of [".claude/skills/cortex-capture", ".claude/commands/cortex-save.md"]) {
    const file = homeFile(ctx, rel);
    try {
      if (!lstatSync(file).isSymbolicLink()) continue;
      const target = readlinkSync(file);
      if (!target.includes("config/skills") && !target.includes("config/commands")) continue;
      if (!ctx.dryRun) rmSync(file, { force: true });
      report.changed.push(`old symlink removed (${tilde(ctx, file)}): the plugin provides it`);
    } catch {
      /* it does not exist: nothing to clean */
    }
  }
}

/** Registers the MCP as `cortex mcp`, replacing the old registration when there is one. */
function ensureMcp(ctx: SetupCtx, report: SetupReport): void {
  const state = mcpState(ctx);
  if (state === "ok") {
    report.skipped.push("MCP `cortex` already registered as `cortex mcp`");
    return;
  }
  if (state === "legacy") {
    report.changed.push("MCP `cortex` pointed at the cloned repo — re-registering it against the server");
    if (!ctx.dryRun) {
      try {
        ctx.exec("claude", ["mcp", "remove", "cortex", "-s", "user"]);
      } catch {
        /* if it cannot be removed, the add below will have its say */
      }
    }
  } else {
    report.changed.push("MCP `cortex` → `cortex mcp`");
  }
  if (ctx.dryRun) return;
  try {
    ctx.exec("claude", ["mcp", "add", "cortex", "-s", "user", "--", "cortex", "mcp"]);
  } catch (e) {
    report.warnings.push(`could not register the MCP: ${(e as Error).message}. Do it with: claude mcp add cortex -s user -- cortex mcp`);
  }
}

/** Writes (or removes) Cortex's hooks in ~/.claude/settings.json. */
function writeHooks(ctx: SetupCtx, report: SetupReport, mode: "install" | "uninstall"): void {
  const file = settingsFile(ctx);
  const obj = readJson<HooksHolder>(file);
  if (obj === null) {
    report.warnings.push(`${tilde(ctx, file)} is not valid JSON, so it was left alone. Fix the file, or add the hooks by hand.`);
    return;
  }
  const settings: HooksHolder = obj ?? {};
  if (mode === "install") {
    const res = mergeHooks(settings, HOOK_DEFS);
    if (res.replacedLegacy.length) report.changed.push(`${res.replacedLegacy.length} hook(s) from an older version updated`);
    if (res.changed.length === 0) {
      report.skipped.push("hooks in settings.json already up to date");
      return;
    }
    report.changed.push(...res.changed.map((c) => `hook ${c}`));
  } else {
    const res = removeHooks(settings);
    if (res.changed.length === 0) {
      report.skipped.push("there were no Cortex hooks in settings.json");
      return;
    }
    report.changed.push(...res.changed);
  }
  writeJson(ctx, file, settings);
}

function pluginInstalled(ctx: SetupCtx): boolean {
  const obj = readJson<{ plugins?: Record<string, unknown> }>(homeFile(ctx, ".claude/plugins/installed_plugins.json"));
  return Boolean(obj && obj.plugins && PLUGIN in obj.plugins);
}

/** Installs the plugin. Returns false when it could not (private repo with no access, old CLI...). */
function tryPlugin(ctx: SetupCtx, report: SetupReport): boolean {
  if (ctx.dryRun) {
    report.changed.push(`plugin ${PLUGIN} (marketplace ${MARKETPLACE_SOURCE}) — would install`);
    return true;
  }
  try {
    try {
      ctx.exec("claude", ["plugin", "marketplace", "add", MARKETPLACE_SOURCE]);
    } catch (e) {
      // "already exists" is the normal case on the second run.
      if (!/already exists|already added/i.test((e as Error).message)) throw e;
    }
    ctx.exec("claude", ["plugin", "install", PLUGIN, "--scope", "user", "--yes"]);
    report.changed.push(`plugin ${PLUGIN} installed (hooks, MCP, skill and /cortex-save)`);
    return true;
  } catch (e) {
    report.warnings.push(
      `could not install the plugin (${(e as Error).message.split("\n")[0]}). Falling back to hooks in settings.json; if you wanted the plugin, check you have access to ${MARKETPLACE_SOURCE}.`,
    );
    return false;
  }
}

export const claudeCodeAdapter: AgentAdapter = {
  id: "claude-code",
  bin: "claude",

  async apply(ctx: SetupCtx): Promise<SetupReport> {
    const report = emptyReport();
    const viaPlugin = ctx.noPlugin ? false : tryPlugin(ctx, report);

    if (viaPlugin) {
      // The plugin already brings its hooks and its MCP: leaving them in settings.json too
      // would mean injecting the context twice and distilling the session twice.
      writeHooks(ctx, report, "uninstall");
      if (mcpState(ctx) !== "missing") {
        report.changed.push("user-level MCP `cortex` removed: the plugin provides it");
        if (!ctx.dryRun) {
          try {
            ctx.exec("claude", ["mcp", "remove", "cortex", "-s", "user"]);
          } catch {
            report.warnings.push("there is a user-level MCP `cortex` as well as the plugin; remove it with: claude mcp remove cortex -s user");
          }
        }
      }
    } else {
      writeHooks(ctx, report, "install");
      ensureMcp(ctx, report);
    }

    dropLegacyLinks(ctx, report);
    return report;
  },

  async remove(ctx: SetupCtx): Promise<SetupReport> {
    const report = emptyReport();
    if (pluginInstalled(ctx)) {
      if (!ctx.dryRun) {
        try {
          ctx.exec("claude", ["plugin", "uninstall", PLUGIN]);
          report.changed.push(`plugin ${PLUGIN} uninstalled`);
        } catch (e) {
          report.warnings.push(`could not uninstall the plugin: ${(e as Error).message}`);
        }
      } else report.changed.push(`plugin ${PLUGIN} — would uninstall`);
    }
    writeHooks(ctx, report, "uninstall");
    if (mcpState(ctx) !== "missing") {
      report.changed.push("MCP `cortex` removed");
      if (!ctx.dryRun) {
        try {
          ctx.exec("claude", ["mcp", "remove", "cortex", "-s", "user"]);
        } catch {
          report.warnings.push("could not remove the MCP: claude mcp remove cortex -s user");
        }
      }
    }
    return report;
  },

  async status(ctx: SetupCtx): Promise<AgentStatus> {
    const details: string[] = [];
    const plugin = pluginInstalled(ctx);
    if (plugin) details.push(`plugin ${PLUGIN} installed`);
    const settings = readJson<HooksHolder>(settingsFile(ctx));
    const hooks = Boolean(settings && hasCortexHooks(settings));
    if (hooks) details.push("hooks in settings.json");
    const mcp = mcpState(ctx);
    details.push(mcp === "ok" ? "MCP `cortex mcp` registered" : mcp === "legacy" ? "MCP registered with the OLD command" : "MCP not registered");
    if (plugin && hooks) details.push("⚠️ both plugin and hooks: the session would be captured twice (run `cortex setup claude-code`)");
    return { installed: plugin || hooks, details };
  },
};

/** It exists only for the tests: checking the hook plan without going through the filesystem. */
export const CLAUDE_HOOK_DEFS = HOOK_DEFS;

export function claudeSettingsPath(ctx: SetupCtx): string {
  return settingsFile(ctx);
}

export const claudePluginInstalled = pluginInstalled;
export const claudeMcpState = mcpState;

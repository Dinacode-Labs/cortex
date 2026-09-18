import { homeFile, readText, tilde, writeText } from "./fs.js";
import { MARKETPLACE, MARKETPLACE_SOURCE, PLUGIN } from "./claude-code.js";
import { emptyReport, type AgentAdapter, type AgentStatus, type SetupCtx, type SetupReport } from "./types.js";

/**
 * Codex. As it turns out, it reads **the same marketplace** as Claude Code -- this repo's
 * `.claude-plugin/marketplace.json` -- and accepts the same plugin: it is installed with
 * `codex plugin add` and copies hooks, skill and command. Verified with `codex plugin list`
 * against the local repo.
 *
 * The only thing it does not take from the plugin is the MCP, registered separately with
 * `codex mcp add`.
 *
 * Its hook events are the same as Claude's (SessionStart, SessionEnd, PreCompact...), which is
 * why the capture hook does not have the agent hardcoded: it derives it from the transcript's
 * path. One plugin for both.
 *
 * What remains is `cortex sync`'s legacy, which wrote a `[[hooks.SessionStart]]` and a
 * `[mcp_servers.cortex]` into `config.toml` by hand, pointing at the cloned repo.
 */

const CONFIG = (ctx: SetupCtx): string => homeFile(ctx, ".codex/config.toml");

/** Is the `cortex` MCP registered and pointing at the CLI (rather than the cloned repo)? */
function mcpState(ctx: SetupCtx): "missing" | "ok" | "legacy" {
  try {
    const out = ctx.exec("codex", ["mcp", "get", "cortex"]);
    return /\bcortex\b[\s\S]*\bmcp\b/.test(out) && !/pnpm|--filter/.test(out) ? "ok" : "legacy";
  } catch {
    return "missing";
  }
}

/**
 * Removes from `config.toml` the blocks `cortex sync` wrote: the `[mcp_servers.cortex]` that
 * pointed at the cloned repo and the `[[hooks.SessionStart]]` with the old command.
 *
 * It is done by splitting the file into blocks line by line rather than with a regular
 * expression: TOML values contain brackets (`args = [ ... ]`) and any pattern looking for
 * "up to the next [" cuts through the middle of an array. A full TOML parser, to delete two
 * blocks, is not worth it.
 */
function stripLegacyToml(ctx: SetupCtx, report: SetupReport): void {
  const file = CONFIG(ctx);
  const raw = readText(file);
  if (raw === null) return;

  // A block = its header plus everything up to the next header.
  const blocks: string[][] = [];
  let head: string[] = [];
  for (const line of raw.split("\n")) {
    if (/^\[/.test(line)) blocks.push((head = [line]));
    else if (blocks.length) head.push(line);
    else (blocks[0] ??= head).push(line); // preamble with no header
  }

  const isCortexMcp = (b: string[]): boolean => /^\[mcp_servers\.cortex\]/.test(b[0]!) && b.join("\n").includes("@cortex/mcp-server");
  const isCortexHook = (b: string[]): boolean => /^\[\[hooks\./.test(b[0]!) && /hook[-:](context|capture)/.test(b.join("\n"));

  const kept: string[][] = [];
  for (let i = 0; i < blocks.length; i++) {
    const b = blocks[i]!;
    if (isCortexMcp(b)) continue;
    // A hook is `[[hooks.Event]]` followed by its `[[hooks.Event.hooks]]`: the command is in
    // the second one, so when the child is redundant so is its header.
    if (/^\[\[hooks\.[A-Za-z]+\]\]/.test(b[0]!)) {
      const grupo = [b];
      let j = i + 1;
      while (j < blocks.length && /^\[\[hooks\.[A-Za-z]+\.hooks\]\]/.test(blocks[j]![0]!)) grupo.push(blocks[j++]!);
      if (grupo.some(isCortexHook)) {
        i = j - 1;
        continue;
      }
    }
    kept.push(b);
  }

  const out = kept.map((b) => b.join("\n")).join("\n").replace(/\n{3,}/g, "\n\n");
  if (out === raw) return;
  writeText(ctx, file, out.endsWith("\n") ? out : out + "\n");
  report.changed.push(`old Cortex blocks removed from ${tilde(ctx, file)} (they pointed at the cloned repo)`);
}

function ensureMcp(ctx: SetupCtx, report: SetupReport): void {
  const state = mcpState(ctx);
  if (state === "ok") {
    report.skipped.push("MCP `cortex` already registered as `cortex mcp`");
    return;
  }
  report.changed.push(state === "legacy" ? "MCP `cortex` re-registered against the server" : "MCP `cortex` → `cortex mcp`");
  if (ctx.dryRun) return;
  if (state === "legacy") {
    try {
      ctx.exec("codex", ["mcp", "remove", "cortex"]);
    } catch {
      /* the add will say so */
    }
  }
  try {
    ctx.exec("codex", ["mcp", "add", "cortex", "--", "cortex", "mcp"]);
  } catch (e) {
    report.warnings.push(`could not register the MCP: ${(e as Error).message.split("\n")[0]}. Do it with: codex mcp add cortex -- cortex mcp`);
  }
}

function pluginInstalled(ctx: SetupCtx): boolean {
  const raw = readText(CONFIG(ctx));
  return Boolean(raw && new RegExp(`\\[plugins\\."${PLUGIN.replace(/[.@]/g, "\\$&")}"\\]`).test(raw));
}

export const codexAdapter: AgentAdapter = {
  id: "codex",
  bin: "codex",

  async apply(ctx: SetupCtx): Promise<SetupReport> {
    const report = emptyReport();
    if (ctx.dryRun) {
      report.changed.push(`plugin ${PLUGIN} (marketplace ${MARKETPLACE_SOURCE}) — would install`);
    } else {
      try {
        try {
          ctx.exec("codex", ["plugin", "marketplace", "add", MARKETPLACE_SOURCE]);
        } catch (e) {
          if (!/already|exists/i.test((e as Error).message)) throw e;
        }
        ctx.exec("codex", ["plugin", "add", PLUGIN]);
        report.changed.push(`plugin ${PLUGIN} installed (hooks, skill and /cortex-save)`);
      } catch (e) {
        report.warnings.push(
          `could not install the plugin (${(e as Error).message.split("\n")[0]}). Check you have access to ${MARKETPLACE_SOURCE}; the MCP is registered anyway.`,
        );
      }
    }
    ensureMcp(ctx, report);
    stripLegacyToml(ctx, report);
    return report;
  },

  async remove(ctx: SetupCtx): Promise<SetupReport> {
    const report = emptyReport();
    if (!ctx.dryRun) {
      for (const args of [
        ["plugin", "remove", PLUGIN],
        ["plugin", "marketplace", "remove", MARKETPLACE],
        ["mcp", "remove", "cortex"],
      ]) {
        try {
          ctx.exec("codex", args);
          report.changed.push(`codex ${args.join(" ")}`);
        } catch {
          /* whatever was not there does not need removing */
        }
      }
    } else report.changed.push(`plugin ${PLUGIN} and MCP — would remove`);
    stripLegacyToml(ctx, report);
    return report;
  },

  async status(ctx: SetupCtx): Promise<AgentStatus> {
    const details: string[] = [];
    const plugin = pluginInstalled(ctx);
    if (plugin) details.push(`plugin ${PLUGIN} installed`);
    const mcp = mcpState(ctx);
    details.push(mcp === "ok" ? "MCP `cortex mcp` registered" : mcp === "legacy" ? "MCP registered with the OLD command" : "MCP not registered");
    return { installed: plugin, details };
  },
};

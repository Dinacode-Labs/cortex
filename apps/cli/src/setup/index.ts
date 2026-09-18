import { execFileSync } from "node:child_process";
import { homedir } from "node:os";
import { cleanLegacy } from "./legacy.js";
import { claudeCodeAdapter } from "./claude-code.js";
import { codexAdapter } from "./codex.js";
import { hermesAdapter } from "./hermes.js";
import { openCodeAdapter } from "./opencode.js";
import { piAdapter } from "./pi.js";
import { AGENT_IDS, emptyReport, type AgentAdapter, type AgentId, type SetupCtx, type SetupReport } from "./types.js";

/**
 * `cortex setup`'s orchestrator: it picks adapters, runs them and cleans up the legacy install
 * once at the end (the old shim belongs to no agent in particular).
 */

const ADAPTERS: Partial<Record<AgentId, AgentAdapter>> = {
  "claude-code": claudeCodeAdapter,
  codex: codexAdapter,
  opencode: openCodeAdapter,
  hermes: hermesAdapter,
  pi: piAdapter,
};

/** The binary that gives each agent away, including those with no adapter yet. */
const AGENT_BINS: Record<AgentId, string> = {
  "claude-code": "claude",
  opencode: "opencode",
  codex: "codex",
  hermes: "hermes",
  pi: "pi",
};

export function defaultCtx(overrides: Partial<SetupCtx> = {}): SetupCtx {
  return {
    home: process.env.CORTEX_HOME?.trim() || homedir(),
    dryRun: false,
    remove: false,
    noPlugin: false,
    log: (line) => console.log(line),
    detect: (bin) => {
      try {
        execFileSync("/bin/sh", ["-c", `command -v ${bin}`], { stdio: "ignore" });
        return true;
      } catch {
        return false;
      }
    },
    exec: (bin, args) => execFileSync(bin, args, { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }),
    now: () => new Date(),
    ...overrides,
  };
}

export function getAdapter(id: AgentId): AgentAdapter | undefined {
  return ADAPTERS[id];
}

/** Agents present on the machine, adapter or not. */
export function detectAgents(ctx: SetupCtx): AgentId[] {
  return AGENT_IDS.filter((id) => ctx.detect(AGENT_BINS[id]));
}

export function agentBin(id: AgentId): string {
  return AGENT_BINS[id];
}

export interface RunResult {
  /** The agent, or "system" for what belongs to none of them (the old shim). */
  id: AgentId | "sistema";
  report: SetupReport;
}

export async function runSetup(agents: AgentId[], ctx: SetupCtx): Promise<RunResult[]> {
  const out: RunResult[] = [];
  for (const id of agents) {
    const adapter = ADAPTERS[id];
    if (!adapter) {
      const report = emptyReport();
      report.warnings.push("no automatic integration for this agent in this version yet");
      out.push({ id, report });
      continue;
    }
    out.push({ id, report: ctx.remove ? await adapter.remove(ctx) : await adapter.apply(ctx) });
  }
  // The legacy install belongs to the system, not to an agent: cleaned once, and only on install.
  if (!ctx.remove) {
    const report = emptyReport();
    cleanLegacy(ctx, report);
    if (report.changed.length || report.warnings.length) out.push({ id: "sistema", report });
  }
  return out;
}

export { AGENT_IDS };
export type { AgentId, SetupCtx, SetupReport };

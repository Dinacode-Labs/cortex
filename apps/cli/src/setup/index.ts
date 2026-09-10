import { execFileSync } from "node:child_process";
import { homedir } from "node:os";
import { cleanLegacy } from "./legacy.js";
import { claudeCodeAdapter } from "./claude-code.js";
import { AGENT_IDS, emptyReport, type AgentAdapter, type AgentId, type SetupCtx, type SetupReport } from "./types.js";

/**
 * Orquestador de `cortex setup`: elige adaptadores, los ejecuta y limpia el legado una sola
 * vez al final (el shim viejo no es de ningún agente en concreto).
 *
 * Los adaptadores que faltan (opencode, codex, hermes, pi) llegan en el PR siguiente; aquí ya
 * se declara la lista completa para que `--status` diga la verdad sobre lo que hay detectado.
 */

const ADAPTERS: Partial<Record<AgentId, AgentAdapter>> = {
  "claude-code": claudeCodeAdapter,
};

/** Binario que delata a cada agente, también para los que aún no tienen adaptador. */
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

/** Agentes presentes en la máquina, tengan adaptador o no. */
export function detectAgents(ctx: SetupCtx): AgentId[] {
  return AGENT_IDS.filter((id) => ctx.detect(AGENT_BINS[id]));
}

export function agentBin(id: AgentId): string {
  return AGENT_BINS[id];
}

export interface RunResult {
  /** El agente, o «sistema» para lo que no pertenece a ninguno (el shim antiguo). */
  id: AgentId | "sistema";
  report: SetupReport;
}

export async function runSetup(agents: AgentId[], ctx: SetupCtx): Promise<RunResult[]> {
  const out: RunResult[] = [];
  for (const id of agents) {
    const adapter = ADAPTERS[id];
    if (!adapter) {
      const report = emptyReport();
      report.warnings.push("todavía no hay integración automática para este agente en esta versión");
      out.push({ id, report });
      continue;
    }
    out.push({ id, report: ctx.remove ? await adapter.remove(ctx) : await adapter.apply(ctx) });
  }
  // El legado es del sistema, no de un agente: se limpia una vez y solo al instalar.
  if (!ctx.remove) {
    const report = emptyReport();
    cleanLegacy(ctx, report);
    if (report.changed.length || report.warnings.length) out.push({ id: "sistema", report });
  }
  return out;
}

export { AGENT_IDS };
export type { AgentId, SetupCtx, SetupReport };

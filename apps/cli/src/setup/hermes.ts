import { parse as yamlParse, stringify as yamlStringify } from "yaml";
import { existsSync } from "node:fs";
import { backupOnce, homeFile, readText, tilde, writeText } from "./fs.js";
import { emptyReport, type AgentAdapter, type AgentStatus, type SetupCtx, type SetupReport } from "./types.js";

/**
 * Hermes (Nous Research). Todo vive en un único `~/.hermes/config.yaml`: el MCP en
 * `mcp_servers` y los hooks en `hooks`, con un array por evento.
 *
 * Dos avisos que no podemos resolver por él y por eso se dicen en voz alta: Hermes pide
 * consentimiento explícito para ejecutar shell hooks (hay que aceptarlo dentro de Hermes, no
 * se escribe su allowlist desde fuera), y leer sus sesiones necesita `node:sqlite`, es decir
 * Node ≥ 22.5.
 *
 * Se conserva el `pre_llm_call` como evento de inyección porque es el que Hermes tiene para
 * eso; lo que se retira es la versión antigua del comando, la que apuntaba al repo clonado.
 */

const CONFIG = (ctx: SetupCtx): string => homeFile(ctx, ".hermes/config.yaml");

const CONTEXT_CMD = "cortex hook-context --format hermes";
const CAPTURE_CMD = "cortex hook-capture --platform hermes";

interface HermesConfig {
  mcp_servers?: Record<string, { command?: string; args?: string[]; url?: string; enabled?: boolean }>;
  hooks?: Record<string, { command?: string }[]>;
  [k: string]: unknown;
}

/** `null` = existe pero no parsea (no se toca); `{}` = no existe todavía. */
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

/** Instala o actualiza un hook de Cortex en un evento, sin duplicarlo ni tocar los ajenos. */
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
  return `hook ${event} actualizado (venía de una versión anterior)`;
}

export const hermesAdapter: AgentAdapter = {
  id: "hermes",
  bin: "hermes",

  async apply(ctx: SetupCtx): Promise<SetupReport> {
    const report = emptyReport();
    const cfg = read(ctx);
    if (!cfg) {
      report.warnings.push(`${tilde(ctx, CONFIG(ctx))} no es YAML válido — no lo toco.`);
      return report;
    }
    cfg.mcp_servers ??= {};
    const want = { command: "cortex", args: ["mcp"], enabled: true };
    if (JSON.stringify(cfg.mcp_servers.cortex) === JSON.stringify(want)) {
      report.skipped.push("MCP `cortex` ya declarado");
    } else {
      if (cfg.mcp_servers.cortex?.command === "pnpm") report.changed.push("MCP `cortex` apuntaba al repo clonado — re-declarado");
      else report.changed.push("MCP `cortex` declarado en config.yaml");
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
    report.warnings.push("Hermes pide permiso para los shell hooks: acéptalo dentro de Hermes la primera vez (allowlist).");
    report.warnings.push("La captura de Hermes lee su SQLite: necesita Node ≥ 22.5.");
    return report;
  },

  async remove(ctx: SetupCtx): Promise<SetupReport> {
    const report = emptyReport();
    const cfg = read(ctx);
    if (!cfg || !existsSync(CONFIG(ctx))) return report;
    if (cfg.mcp_servers?.cortex) {
      delete cfg.mcp_servers.cortex;
      report.changed.push("MCP `cortex` fuera de config.yaml");
    }
    for (const [event, hooks] of Object.entries(cfg.hooks ?? {})) {
      const kept = hooks.filter((h) => !isCortex(h.command));
      if (kept.length === hooks.length) continue;
      report.changed.push(`hooks de Cortex fuera de ${event}`);
      if (kept.length) cfg.hooks![event] = kept;
      else delete cfg.hooks![event];
    }
    if (report.changed.length) write(ctx, cfg);
    return report;
  },

  async status(ctx: SetupCtx): Promise<AgentStatus> {
    const cfg = read(ctx);
    if (!cfg) return { installed: false, details: ["config.yaml no parseable"] };
    const mcp = cfg.mcp_servers?.cortex;
    const hooks = Object.values(cfg.hooks ?? {}).flat().filter((h) => isCortex(h.command)).length;
    return {
      installed: hooks > 0,
      details: [
        !mcp ? "MCP no declarado" : mcp.command === "cortex" ? "MCP `cortex mcp` declarado" : "MCP con el comando ANTIGUO",
        hooks ? `${hooks} hook(s) de Cortex` : "sin hooks de Cortex",
      ],
    };
  },
};

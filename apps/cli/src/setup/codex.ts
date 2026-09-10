import { homeFile, readText, tilde, writeText } from "./fs.js";
import { MARKETPLACE, MARKETPLACE_SOURCE, PLUGIN } from "./claude-code.js";
import { emptyReport, type AgentAdapter, type AgentStatus, type SetupCtx, type SetupReport } from "./types.js";

/**
 * Codex. Resulta que lee **el mismo marketplace** que Claude Code —el
 * `.claude-plugin/marketplace.json` de este repo— y acepta el mismo plugin: se instala con
 * `codex plugin add` y copia hooks, skill y comando. Comprobado con `codex plugin list`
 * contra el repo local.
 *
 * Lo único que no coge del plugin es el MCP, que se registra aparte con `codex mcp add`.
 *
 * Sus eventos de hook son los mismos que los de Claude (SessionStart, SessionEnd,
 * PreCompact…), y por eso el hook de captura no lleva el agente cableado: lo deduce de la
 * ruta del transcript. Un solo plugin para los dos.
 *
 * Queda el legado de `cortex sync`, que escribía a mano en `config.toml` un
 * `[[hooks.SessionStart]]` y un `[mcp_servers.cortex]` apuntando al repo clonado.
 */

const CONFIG = (ctx: SetupCtx): string => homeFile(ctx, ".codex/config.toml");

/** ¿Está el MCP `cortex` registrado y apuntando al CLI (y no al repo clonado)? */
function mcpState(ctx: SetupCtx): "missing" | "ok" | "legacy" {
  try {
    const out = ctx.exec("codex", ["mcp", "get", "cortex"]);
    return /\bcortex\b[\s\S]*\bmcp\b/.test(out) && !/pnpm|--filter/.test(out) ? "ok" : "legacy";
  } catch {
    return "missing";
  }
}

/**
 * Quita del `config.toml` los bloques que escribió `cortex sync`: el `[mcp_servers.cortex]`
 * que apuntaba al repo clonado y el `[[hooks.SessionStart]]` con el comando viejo.
 *
 * Se hace partiendo el fichero en bloques por línea en vez de con una expresión regular:
 * los valores TOML llevan corchetes (`args = [ ... ]`) y cualquier patrón que busque «hasta
 * el siguiente [» se corta a mitad de un array. Un parser de TOML completo, para borrar dos
 * bloques, no compensa.
 */
function stripLegacyToml(ctx: SetupCtx, report: SetupReport): void {
  const file = CONFIG(ctx);
  const raw = readText(file);
  if (raw === null) return;

  // Un bloque = su encabezado y todo lo que hay hasta el siguiente encabezado.
  const blocks: string[][] = [];
  let head: string[] = [];
  for (const line of raw.split("\n")) {
    if (/^\[/.test(line)) blocks.push((head = [line]));
    else if (blocks.length) head.push(line);
    else (blocks[0] ??= head).push(line); // preámbulo sin encabezado
  }

  const isCortexMcp = (b: string[]): boolean => /^\[mcp_servers\.cortex\]/.test(b[0]!) && b.join("\n").includes("@cortex/mcp-server");
  const isCortexHook = (b: string[]): boolean => /^\[\[hooks\./.test(b[0]!) && /hook[-:](context|capture)/.test(b.join("\n"));

  const kept: string[][] = [];
  for (let i = 0; i < blocks.length; i++) {
    const b = blocks[i]!;
    if (isCortexMcp(b)) continue;
    // Un hook es `[[hooks.Evento]]` seguido de sus `[[hooks.Evento.hooks]]`: el comando está
    // en el segundo, así que si sobra el hijo, sobra también su encabezado.
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
      /* lo dirá el add */
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
          /* lo que no estuviera, no hay que quitarlo */
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

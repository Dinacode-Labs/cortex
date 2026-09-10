import { existsSync, rmSync } from "node:fs";
import { GENERATED_MARKER, emptyReport, type AgentAdapter, type AgentStatus, type SetupCtx, type SetupReport } from "./types.js";
import { homeFile, readJson, removeIfGenerated, tilde, writeIfChanged, writeJson } from "./fs.js";

/**
 * OpenCode. No tiene hooks de proceso: la integración es un **plugin JS** que escucha los
 * eventos de sesión, más el MCP declarado en `opencode.json`.
 *
 * OpenCode 1.18 carga los plugins tanto de `~/.config/opencode/plugin/` como de
 * `plugins/` (comprobado poniendo una sonda en cada carpeta). Se escribe en `plugins/`, que
 * es la documentada, y se retira el fichero de la otra para no cargar el plugin dos veces
 * —que inyectaría el contexto por duplicado.
 *
 * La captura se dispara con `session.idle` (con un mínimo entre capturas, porque salta cada
 * vez que el agente termina un turno) y con `session.deleted`. Enviar de más no cuesta: el
 * servidor deduplica por hash y solo destila lo que ha crecido (ADR-0025).
 */

const CONFIG = (ctx: SetupCtx): string => homeFile(ctx, ".config/opencode/opencode.json");
const PLUGIN_FILE = (ctx: SetupCtx): string => homeFile(ctx, ".config/opencode/plugins/cortex.js");
const LEGACY_PLUGIN = (ctx: SetupCtx): string => homeFile(ctx, ".config/opencode/plugin/cortex.js");
const COMMAND_FILE = (ctx: SetupCtx): string => homeFile(ctx, ".config/opencode/command/cortex-save.md");

const PLUGIN_JS = `// ${GENERATED_MARKER} — no edites este fichero (se regenera con \`cortex setup opencode\`).
// Inyecta el contexto del proyecto al abrir sesión y manda la sesión a Cortex al terminarla.
export const CortexPlugin = async ({ $, directory }) => {
  let pending = null;
  const lastCapture = new Map();
  const MIN_MS = 10 * 60 * 1000; // session.idle salta en cada turno: no capturamos en cada uno

  const capture = async (id) => {
    if (!id) return;
    try {
      await $\`cortex hook-capture --platform opencode --session \${id} --cwd \${directory}\`.quiet().nothrow();
      lastCapture.set(id, Date.now());
    } catch {}
  };
  const sessionId = (event) => event.properties?.sessionID ?? event.properties?.info?.id ?? event.properties?.id;

  return {
    event: async ({ event }) => {
      try {
        if (event.type === "session.created") {
          const r = await $\`cortex hook-context --format text --cwd \${directory}\`.quiet().nothrow();
          if (r.exitCode === 0) {
            const t = r.stdout.toString().trim();
            if (t) pending = t;
          }
        } else if (event.type === "session.idle") {
          const id = sessionId(event);
          if (id && Date.now() - (lastCapture.get(id) ?? 0) > MIN_MS) await capture(id);
        } else if (event.type === "session.deleted") {
          await capture(sessionId(event));
        }
      } catch {}
    },
    "chat.message": async (_input, output) => {
      if (pending) {
        output.parts.push({ type: "text", text: pending });
        pending = null;
      }
    },
  };
};
`;

const COMMAND_MD = `---
description: Save project knowledge to Cortex
---

${GENERATED_MARKER}. Use the \`save_project_context\` tool (MCP \`cortex\`) to save what was just
decided or discovered in the project linked to this folder. Summarise it in a sentence or two,
say where it came from, and do not invent anything that was not said.
`;

interface McpEntry {
  type?: string;
  command?: string[];
  url?: string;
  enabled?: boolean;
}
interface OpenCodeConfig {
  $schema?: string;
  mcp?: Record<string, McpEntry>;
  [k: string]: unknown;
}

const cortexMcp = (): McpEntry => ({ type: "local", command: ["cortex", "mcp"], enabled: true });

export const openCodeAdapter: AgentAdapter = {
  id: "opencode",
  bin: "opencode",

  async apply(ctx: SetupCtx): Promise<SetupReport> {
    const report = emptyReport();
    const file = CONFIG(ctx);
    const cfg = readJson<OpenCodeConfig>(file);
    if (cfg === null) {
      report.warnings.push(`${tilde(ctx, file)} is not valid JSON, so it was left alone. Add the \`cortex\` MCP by hand.`);
    } else {
      const conf: OpenCodeConfig = cfg ?? {};
      conf.$schema ??= "https://opencode.ai/config.json";
      conf.mcp ??= {};
      const actual = conf.mcp.cortex;
      if (JSON.stringify(actual) === JSON.stringify(cortexMcp())) {
        report.skipped.push("MCP `cortex` already declared");
      } else {
        if (actual?.command?.includes("pnpm")) report.changed.push("MCP `cortex` pointed at the cloned repo — re-declared against the server");
        else report.changed.push("MCP `cortex` declared in opencode.json");
        conf.mcp.cortex = cortexMcp();
        writeJson(ctx, file, conf);
      }
    }

    if (writeIfChanged(ctx, PLUGIN_FILE(ctx), PLUGIN_JS)) report.changed.push(`plugin written to ${tilde(ctx, PLUGIN_FILE(ctx))}`);
    else report.skipped.push("plugin already up to date");

    // OpenCode carga las dos carpetas: dejar el fichero en las dos inyectaría dos veces.
    const legacy = LEGACY_PLUGIN(ctx);
    if (existsSync(legacy)) {
      if (!ctx.dryRun) rmSync(legacy, { force: true });
      report.changed.push(`duplicate plugin removed (${tilde(ctx, legacy)})`);
    }

    if (writeIfChanged(ctx, COMMAND_FILE(ctx), COMMAND_MD)) report.changed.push(`/cortex-save command written to ${tilde(ctx, COMMAND_FILE(ctx))}`);
    else report.skipped.push("/cortex-save already up to date");
    return report;
  },

  async remove(ctx: SetupCtx): Promise<SetupReport> {
    const report = emptyReport();
    const file = CONFIG(ctx);
    const cfg = readJson<OpenCodeConfig>(file);
    if (cfg && cfg.mcp?.cortex) {
      delete cfg.mcp.cortex;
      writeJson(ctx, file, cfg);
      report.changed.push("MCP `cortex` removed from opencode.json");
    }
    for (const f of [PLUGIN_FILE(ctx), LEGACY_PLUGIN(ctx), COMMAND_FILE(ctx)]) {
      if (removeIfGenerated(ctx, f)) report.changed.push(`${tilde(ctx, f)} removed`);
    }
    return report;
  },

  async status(ctx: SetupCtx): Promise<AgentStatus> {
    const cfg = readJson<OpenCodeConfig>(CONFIG(ctx));
    const mcp = cfg?.mcp?.cortex;
    const details: string[] = [];
    details.push(!mcp ? "MCP not declared" : mcp.command?.includes("pnpm") ? "MCP with the OLD command" : "MCP `cortex mcp` declared");
    const plugin = existsSync(PLUGIN_FILE(ctx));
    if (plugin) details.push("plugin installed (context and capture)");
    if (existsSync(LEGACY_PLUGIN(ctx))) details.push("⚠️ duplicate plugin in plugin/ (run `cortex setup opencode`)");
    return { installed: plugin, details };
  },
};

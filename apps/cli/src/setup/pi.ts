import { existsSync } from "node:fs";
import { homeFile, readJson, removeIfGenerated, tilde, writeIfChanged, writeJson } from "./fs.js";
import { GENERATED_MARKER, emptyReport, type AgentAdapter, type AgentStatus, type SetupCtx, type SetupReport } from "./types.js";

/**
 * Pi. Las extensiones son ficheros TypeScript sueltos en `~/.pi/agent/extensions/`, que Pi
 * descubre solo, y el MCP se declara en `~/.pi/agent/mcp.json`.
 *
 * El contexto se inyecta en `before_agent_start` como **mensaje** de sesión, no tocando el
 * system prompt: queda guardado en la sesión, el usuario lo ve y no se pisa con lo que hayan
 * puesto otras extensiones. Se inyecta una sola vez por sesión, porque el evento salta en
 * cada turno.
 *
 * La captura sale de `session_shutdown` (y de la compactación automática, que es cuando una
 * sesión larga pierde su principio). `ctx.sessionManager.getSessionFile()` da la ruta del
 * JSONL, que es lo que el hook sabe leer.
 */

const EXT_FILE = (ctx: SetupCtx): string => homeFile(ctx, ".pi/agent/extensions/cortex.ts");
const MCP_FILE = (ctx: SetupCtx): string => homeFile(ctx, ".pi/agent/mcp.json");

const EXTENSION_TS = `// ${GENERATED_MARKER} — no edites este fichero (se regenera con \`cortex setup pi\`).
import { execFile } from "node:child_process";

const run = (args: string[]): Promise<string> =>
  new Promise((resolve) => {
    execFile("cortex", args, { cwd: process.cwd(), timeout: 20000 }, (_err, stdout) => resolve(String(stdout ?? "")));
  });

const sessionFile = (ctx: any): string | null => {
  const f = ctx?.sessionManager?.getSessionFile?.();
  return typeof f === "string" && f ? f : null;
};

export default function (pi: any) {
  let context: string | null = null;
  let injected = false;

  pi.on("session_start", async () => {
    injected = false;
    const out = (await run(["hook-context", "--format", "text", "--cwd", process.cwd()])).trim();
    context = out || null;
  });

  // before_agent_start salta en CADA turno: el contexto se inyecta una vez y ya.
  pi.on("before_agent_start", async () => {
    if (!context || injected) return;
    injected = true;
    return { message: { customType: "cortex-context", content: context, display: true } };
  });

  const capture = async (ctx: any): Promise<void> => {
    const f = sessionFile(ctx);
    if (f) await run(["hook-capture", "--platform", "pi", "--session", f, "--cwd", process.cwd()]);
  };
  pi.on("session_shutdown", async (_event: unknown, ctx: any) => capture(ctx));
  pi.on("auto_compaction_start", async (_event: unknown, ctx: any) => capture(ctx));
}
`;

interface PiMcp {
  mcpServers?: Record<string, { command?: string; args?: string[] }>;
  [k: string]: unknown;
}

export const piAdapter: AgentAdapter = {
  id: "pi",
  bin: "pi",

  async apply(ctx: SetupCtx): Promise<SetupReport> {
    const report = emptyReport();
    if (writeIfChanged(ctx, EXT_FILE(ctx), EXTENSION_TS)) report.changed.push(`extension written to ${tilde(ctx, EXT_FILE(ctx))} (context and capture)`);
    else report.skipped.push("extension already up to date");

    const file = MCP_FILE(ctx);
    const cfg = readJson<PiMcp>(file);
    if (cfg === null) {
      report.warnings.push(`${tilde(ctx, file)} is not valid JSON, so it was left alone. Add the \`cortex\` MCP by hand.`);
      return report;
    }
    const conf: PiMcp = cfg ?? {};
    conf.mcpServers ??= {};
    const want = { command: "cortex", args: ["mcp"] };
    if (JSON.stringify(conf.mcpServers.cortex) === JSON.stringify(want)) {
      report.skipped.push("MCP `cortex` already declared");
    } else {
      conf.mcpServers.cortex = want;
      writeJson(ctx, file, conf);
      report.changed.push("MCP `cortex` declared in mcp.json");
      report.warnings.push("Pi speaks MCP through `pi-mcp-adapter`. If you do not have it: pi install npm:pi-mcp-adapter");
    }
    return report;
  },

  async remove(ctx: SetupCtx): Promise<SetupReport> {
    const report = emptyReport();
    if (removeIfGenerated(ctx, EXT_FILE(ctx))) report.changed.push(`${tilde(ctx, EXT_FILE(ctx))} removed`);
    const cfg = readJson<PiMcp>(MCP_FILE(ctx));
    if (cfg?.mcpServers?.cortex) {
      delete cfg.mcpServers.cortex;
      writeJson(ctx, MCP_FILE(ctx), cfg);
      report.changed.push("MCP `cortex` removed from mcp.json");
    }
    return report;
  },

  async status(ctx: SetupCtx): Promise<AgentStatus> {
    const ext = existsSync(EXT_FILE(ctx));
    const cfg = readJson<PiMcp>(MCP_FILE(ctx));
    return {
      installed: ext,
      details: [ext ? "extension installed (context and capture)" : "extension not installed", cfg?.mcpServers?.cortex ? "MCP declared" : "MCP not declared"],
    };
  },
};

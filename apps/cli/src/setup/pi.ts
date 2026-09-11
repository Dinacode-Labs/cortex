import { existsSync } from "node:fs";
import { homeFile, readJson, removeIfGenerated, tilde, writeIfChanged, writeJson } from "./fs.js";
import { GENERATED_MARKER, emptyReport, type AgentAdapter, type AgentStatus, type SetupCtx, type SetupReport } from "./types.js";

/**
 * Pi. Las extensiones son ficheros TypeScript sueltos en `~/.pi/agent/extensions/`, que Pi
 * descubre solo, y el MCP se declara en `~/.pi/agent/mcp.json`.
 *
 * El contexto se inyecta en `before_agent_start` **encadenando el system prompt**. Se probó
 * antes devolviendo `{ message }`, que la documentación de Pi también contempla, y no llegaba
 * nunca: el agente arrancaba sin saber nada del proyecto. El encadenado del system prompt es
 * lo que usa la otra extensión de memoria que funciona en esta versión de Pi.
 *
 * Se inyecta una sola vez por sesión, porque el evento salta en cada turno. Y se **espera** a
 * que el contexto haya llegado en vez de comprobar una variable: nada garantiza que Pi aguarde
 * al handler de `session_start` antes de arrancar el primer turno.
 *
 * El directorio sale de `ctx.cwd`, no de `process.cwd()`: el proceso de Pi no tiene por qué
 * estar en el repo de la sesión, y equivocarse ahí es quedarse sin proyecto en silencio.
 *
 * La captura sale de `session_shutdown` (y de la compactación automática, que es cuando una
 * sesión larga pierde su principio). La ruta del JSONL viene en `event.targetSessionFile` o en
 * `ctx.sessionManager.getSessionFile()`, que es lo que el hook sabe leer.
 */

const EXT_FILE = (ctx: SetupCtx): string => homeFile(ctx, ".pi/agent/extensions/cortex.ts");
const MCP_FILE = (ctx: SetupCtx): string => homeFile(ctx, ".pi/agent/mcp.json");

const EXTENSION_TS = `// ${GENERATED_MARKER} — no edites este fichero (se regenera con \`cortex setup pi\`).
import { execFile } from "node:child_process";

const run = (args: string[], cwd: string): Promise<string> =>
  new Promise((resolve) => {
    // stdin cerrado a propósito: el CLI lee el JSON del hook de ahí, y una tubería abierta y
    // muda lo dejaba esperando hasta el timeout. Aquí todo va por argumentos.
    const hijo = execFile("cortex", args, { cwd, timeout: 20000 }, (err, stdout) => {
      // Un fallo aquí dejaba al agente sin contexto sin decir nada. Va a stderr, que en Pi
      // no ensucia la conversación pero sí se puede mirar.
      if (err) console.error(\`[cortex] \${args[0]} falló: \${err.message}\`);
      resolve(String(stdout ?? ""));
    });
    hijo.stdin?.end();
  });

const cwdDe = (ctx: any): string => (typeof ctx?.cwd === "string" && ctx.cwd ? ctx.cwd : process.cwd());

const sessionFile = (event: any, ctx: any): string | null => {
  const f = event?.targetSessionFile ?? ctx?.sessionManager?.getSessionFile?.();
  return typeof f === "string" && f ? f : null;
};

export default function (pi: any) {
  let contexto: Promise<string | null> = Promise.resolve(null);
  let inyectado = false;

  pi.on("session_start", (_event: unknown, ctx: any) => {
    inyectado = false;
    const cwd = cwdDe(ctx);
    contexto = run(["hook-context", "--format", "text", "--cwd", cwd], cwd).then((out) => out.trim() || null);
    return contexto.then(() => undefined);
  });

  // before_agent_start salta en CADA turno: el contexto se inyecta una vez y ya.
  pi.on("before_agent_start", async (event: any) => {
    if (inyectado) return;
    const texto = await contexto;
    if (!texto) return;
    inyectado = true;
    return { systemPrompt: \`\${event?.systemPrompt ?? ""}\n\n\${texto}\` };
  });

  const capture = async (event: any, ctx: any): Promise<void> => {
    const f = sessionFile(event, ctx);
    const cwd = cwdDe(ctx);
    if (f) await run(["hook-capture", "--platform", "pi", "--session", f, "--cwd", cwd], cwd);
  };
  pi.on("session_shutdown", async (event: any, ctx: any) => capture(event, ctx));
  pi.on("auto_compaction_start", async (event: any, ctx: any) => capture(event, ctx));
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

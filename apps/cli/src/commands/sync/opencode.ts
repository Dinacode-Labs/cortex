import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { envPairs, plan, resolveArgs, type AgentAdapter, type McpDef, type SyncCtx } from "./shared.js";

/** OpenCode: MCP en opencode.json y hook vía plugin TS (se regenera entero en cada apply). */
export function openCodeAdapter(ctx: SyncCtx): AgentAdapter {
  const cfg = join(ctx.home, ".config/opencode/opencode.json");

  return {
    bin: "opencode",
    commandsDir: join(ctx.home, ".config/opencode/command"),

    registerMcp(name: string, d: McpDef): void {
      let obj: Record<string, any> = {};
      if (existsSync(cfg)) {
        try {
          obj = JSON.parse(readFileSync(cfg, "utf8"));
        } catch {
          plan(ctx, `${name}: opencode.json no parseable — configúralo a mano`);
          return;
        }
      }
      if (obj.mcp?.[name]) {
        plan(ctx, `${name} ya presente — preservado`);
        return;
      }
      plan(ctx, `(opencode) registrar mcp.${name} en opencode.json`);
      if (!ctx.apply) return;
      obj.$schema ??= "https://opencode.ai/config.json";
      obj.mcp ??= {};
      obj.mcp[name] =
        d.transport === "http"
          ? { type: "remote", url: d.url, enabled: true }
          : { type: "local", command: [d.command, ...resolveArgs(ctx, d.args)], enabled: true, ...(envPairs(d.env).length ? { environment: Object.fromEntries(envPairs(d.env)) } : {}) };
      mkdirSync(join(ctx.home, ".config/opencode"), { recursive: true });
      writeFileSync(cfg, JSON.stringify(obj, null, 2) + "\n");
    },

    /** Plugin que inyecta el context-pack al crear sesión. Generado: reescribirlo ya
     * incorpora la sintaxis de hook vigente. */
    syncHooks(): void {
      const dir = join(ctx.home, ".config/opencode/plugin");
      const file = join(dir, "cortex.js");
      plan(ctx, "(opencode) plugin cortex.js → inyecta context-pack en session.created");
      if (!ctx.apply) return;
      const plugin = `// Generado por 'cortex sync'. Inyecta el context-pack de Cortex al crear sesión.
export const CortexPlugin = async ({ $, directory }) => {
  let pending = null;
  return {
    event: async ({ event }) => {
      try {
        if (event.type === "session.created") {
          const r = await $\`${ctx.hookContextCmd} -- --format text --cwd \${directory}\`.quiet().nothrow();
          if (r.exitCode === 0) { const t = r.stdout.toString().trim(); if (t) pending = t; }
        }
      } catch {}
    },
    "chat.message": async (_input, output) => {
      if (pending) { output.parts.push({ type: "text", text: pending }); pending = null; }
    },
  };
};
`;
      mkdirSync(dir, { recursive: true });
      writeFileSync(file, plugin);
    },
  };
}

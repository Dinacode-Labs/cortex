import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { envPairs, plan, resolveArgs, type AgentAdapter, type McpDef, type SyncCtx } from "./shared.js";

/** Codex: MCP y hooks en ~/.codex/config.toml (append de bloques TOML).
 * Limitación conocida: el TOML se genera por concatenación (valores con comillas o
 * saltos de línea romperían el fichero); suficiente para comandos/paths del toolbelt. */
export function codexAdapter(ctx: SyncCtx): AgentAdapter {
  const toml = join(ctx.home, ".codex/config.toml");
  const read = (): string => (existsSync(toml) ? readFileSync(toml, "utf8") : "");
  const write = (content: string): void => {
    mkdirSync(join(ctx.home, ".codex"), { recursive: true });
    writeFileSync(toml, content);
  };

  return {
    bin: "codex",
    commandsDir: join(ctx.home, ".codex/prompts"),

    registerMcp(name: string, d: McpDef): void {
      if (d.transport !== "stdio") {
        plan(ctx, `(codex) ${name}: transporte http no soportado por el instalador — omitido`);
        return;
      }
      if (read().includes(`[mcp_servers.${name}]`)) {
        plan(ctx, `(codex) ${name} ya presente en config.toml`);
        return;
      }
      const envs = envPairs(d.env);
      let block = `\n[mcp_servers.${name}]\ncommand = "${d.command}"\nargs = [${resolveArgs(ctx, d.args).map((a) => `"${a}"`).join(", ")}]\n`;
      if (envs.length) block += `env = { ${envs.map(([k, v]) => `${k} = "${v}"`).join(", ")} }\n`;
      plan(ctx, `(codex) añadir [mcp_servers.${name}] a config.toml`);
      if (ctx.apply) write(read() + block);
    },

    /** Hook SessionStart en config.toml; actualiza in situ la sintaxis antigua. */
    syncHooks(): void {
      let content = read();
      const stale = ctx.legacyHookCmds.filter((l) => content.includes(l.old));
      if (stale.length) {
        plan(ctx, "(codex) hook de Cortex con sintaxis antigua — actualizar");
        if (ctx.apply) {
          for (const l of stale) content = content.replaceAll(l.old, l.now);
          write(content);
        }
        return;
      }
      if (content.includes("hook:context") || content.includes("cortex hook-context")) {
        plan(ctx, "hook SessionStart (cortex) ya presente en config.toml");
        return;
      }
      plan(ctx, "(codex) hook SessionStart → cortex hook-context");
      if (!ctx.apply) return;
      write(content + `\n[[hooks.SessionStart]]\n\n[[hooks.SessionStart.hooks]]\ntype = "command"\ncommand = "${ctx.hookContextCmd}"\n`);
    },
  };
}

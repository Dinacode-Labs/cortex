import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { parse as yamlParse, stringify as yamlStringify } from "yaml";
import { envPairs, plan, resolveArgs, type AgentAdapter, type McpDef, type SyncCtx } from "./shared.js";

/** Hermes (Nous Research): MCP y hooks en ~/.hermes/config.yaml. */
export function hermesAdapter(ctx: SyncCtx): AgentAdapter {
  const cfg = join(ctx.home, ".hermes/config.yaml");
  const read = (): Record<string, any> | null => {
    if (!existsSync(cfg)) return {};
    try {
      return (yamlParse(readFileSync(cfg, "utf8")) as Record<string, any>) ?? {};
    } catch {
      return null;
    }
  };
  const write = (obj: Record<string, any>): void => {
    mkdirSync(join(ctx.home, ".hermes"), { recursive: true });
    writeFileSync(cfg, yamlStringify(obj));
  };

  return {
    bin: "hermes",

    registerMcp(name: string, d: McpDef): void {
      const obj = read();
      if (!obj) {
        plan(ctx, `${name}: ~/.hermes/config.yaml no parseable — configúralo a mano`);
        return;
      }
      obj.mcp_servers ??= {};
      if (obj.mcp_servers[name]) {
        plan(ctx, `${name} ya presente — preservado`);
        return;
      }
      plan(ctx, `(hermes) añadir mcp_servers.${name} a ~/.hermes/config.yaml`);
      if (!ctx.apply) return;
      obj.mcp_servers[name] =
        d.transport === "http"
          ? { url: d.url, enabled: true }
          : { command: d.command, args: resolveArgs(ctx, d.args), enabled: true, ...(envPairs(d.env).length ? { env: Object.fromEntries(envPairs(d.env)) } : {}) };
      write(obj);
    },

    /** Hook pre_llm_call (inyecta {"context":…}); actualiza la sintaxis antigua in situ. */
    syncHooks(): void {
      const obj = read();
      if (!obj) {
        plan(ctx, "hooks: ~/.hermes/config.yaml no parseable — a mano");
        return;
      }
      obj.hooks ??= {};
      const arr = (obj.hooks.pre_llm_call ??= []) as { command?: string }[];
      const expected = `${ctx.hookContextCmd} -- --format hermes`;
      const mine = arr.filter((h) => typeof h.command === "string" && (h.command.includes("hook:context") || h.command.includes("cortex hook-context")));
      if (mine.length === 0) {
        plan(ctx, "(hermes) hook pre_llm_call → cortex hook-context (formato hermes)");
        if (!ctx.apply) return;
        arr.push({ command: expected } as never);
        write(obj);
        return;
      }
      const stale = mine.filter((h) => h.command !== expected);
      if (stale.length === 0) {
        plan(ctx, "(hermes) hook pre_llm_call (cortex) ya presente");
        return;
      }
      plan(ctx, "(hermes) hook de Cortex con sintaxis antigua — actualizar");
      if (!ctx.apply) return;
      for (const h of stale) h.command = expected;
      write(obj);
    },
  };
}

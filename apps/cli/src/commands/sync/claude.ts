import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { envPairs, plan, resolveArgs, symlink, type AgentAdapter, type McpDef, type SyncCtx } from "./shared.js";

/** Claude Code: MCP vía `claude mcp add`, skills por symlink y hooks en settings.json. */
export function claudeAdapter(ctx: SyncCtx): AgentAdapter {
  const has = (name: string): boolean => {
    try {
      execFileSync("claude", ["mcp", "get", name], { stdio: "ignore" });
      return true;
    } catch {
      return false;
    }
  };

  return {
    bin: "claude",
    commandsDir: join(ctx.home, ".claude/commands"),

    registerMcp(name: string, d: McpDef): void {
      if (has(name)) {
        plan(ctx, `${name} ya registrado — preservado (no toco su auth)`);
        return;
      }
      if (d.transport === "http") {
        plan(ctx, `claude mcp add --transport http ${name} ${d.url}`);
        if (ctx.apply) execFileSync("claude", ["mcp", "add", "--transport", "http", name, d.url!, "-s", "user"], { stdio: "ignore" });
        return;
      }
      const envs = envPairs(d.env);
      const eFlags = envs.flatMap(([k, v]) => ["-e", `${k}=${v}`]);
      const missing = (d.env ?? []).filter((k) => !process.env[k]);
      plan(
        ctx,
        `claude mcp add ${name} -s user ${envs.map(([k]) => `-e ${k}`).join(" ")} -- ${d.command} ${resolveArgs(ctx, d.args).join(" ")}`.replace(/\s+/g, " ") +
          (missing.length ? `   ⚠️ falta env: ${missing.join(",")}` : ""),
      );
      if (ctx.apply) execFileSync("claude", ["mcp", "add", name, "-s", "user", ...eFlags, "--", d.command!, ...resolveArgs(ctx, d.args)], { stdio: "ignore" });
    },

    extras(): void {
      for (const s of ctx.toolbelt.skills) {
        const src = join(ctx.repo, "config/skills", s.name);
        if (existsSync(src)) symlink(ctx, src, join(ctx.home, ".claude/skills", s.name));
      }
    },

    /** Hooks SessionStart/SessionEnd en ~/.claude/settings.json. Si existe un hook de
     * Cortex con la sintaxis antigua (scripts de paquete, pre-B-1), lo ACTUALIZA. */
    syncHooks(): void {
      const file = join(ctx.home, ".claude/settings.json");
      let obj: Record<string, any> = {};
      if (existsSync(file)) {
        try {
          obj = JSON.parse(readFileSync(file, "utf8"));
        } catch {
          plan(ctx, "hooks: ~/.claude/settings.json no parseable — configúralo a mano");
          return;
        }
      }
      obj.hooks ??= {};
      const defs = [
        { event: "SessionStart", markers: ["hook:context", "hook-context"], cmd: ctx.hookContextCmd },
        { event: "SessionEnd", markers: ["hook:capture", "hook-capture"], cmd: ctx.hookCaptureCmd },
      ];
      let changed = false;
      for (const d of defs) {
        const arr = (obj.hooks[d.event] ??= []) as { hooks?: { command?: string }[] }[];
        const mine = arr.flatMap((g) => g.hooks ?? []).filter((h) => typeof h.command === "string" && d.markers.some((m) => h.command!.includes(m)));
        if (mine.length === 0) {
          plan(ctx, `hook ${d.event} → cortex`);
          if (ctx.apply) {
            arr.push({ hooks: [{ type: "command", command: d.cmd }] } as never);
            changed = true;
          }
          continue;
        }
        const stale = mine.filter((h) => h.command !== d.cmd);
        if (stale.length === 0) {
          plan(ctx, `hook ${d.event} (cortex) ya presente — preservado`);
          continue;
        }
        plan(ctx, `hook ${d.event} (cortex) con sintaxis antigua — actualizar`);
        if (ctx.apply) {
          for (const h of stale) h.command = d.cmd;
          changed = true;
        }
      }
      if (ctx.apply && changed) {
        mkdirSync(join(ctx.home, ".claude"), { recursive: true });
        writeFileSync(file, JSON.stringify(obj, null, 2) + "\n");
      }
    },
  };
}

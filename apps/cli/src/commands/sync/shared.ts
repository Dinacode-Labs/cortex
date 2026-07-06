import { execFileSync } from "node:child_process";
import { mkdirSync, readFileSync, rmSync, symlinkSync } from "node:fs";
import { homedir } from "node:os";
import { join, resolve } from "node:path";

/** Registry del toolbelt (config/toolbelt.json). */
export interface McpDef {
  transport: "stdio" | "http";
  command?: string;
  args?: string[];
  url?: string;
  env?: string[];
  auth?: string;
  agents?: string[];
}
export interface Manifest {
  mcpServers: Record<string, McpDef>;
  skills: { name: string; auth?: string }[];
  commands: { name: string; file: string }[];
}

/** Un adapter por agente soportado: cómo registrar MCPs y hooks en SU config. */
export interface AgentAdapter {
  /** Binario cuya presencia delata que el agente está instalado. */
  bin: string;
  registerMcp(name: string, d: McpDef): void;
  /** Hooks de inyección de contexto (y captura, si el agente lo soporta). */
  syncHooks(): void;
  /** Carpeta de comandos/prompts del agente (symlink de config/commands), si existe. */
  commandsDir?: string;
  /** Instalación extra (Claude: skills por symlink). */
  extras?(): void;
}

export interface SyncCtx {
  repo: string;
  home: string;
  apply: boolean;
  toolbelt: Manifest;
  /** Comando actual de cada hook + variantes legacy que hay que actualizar in situ. */
  hookContextCmd: string;
  hookCaptureCmd: string;
  legacyHookCmds: { old: string; now: string }[];
}

export function buildCtx(apply: boolean): SyncCtx {
  const repo = resolve(import.meta.dirname, "../../../../..");
  const hookContextCmd = `pnpm -C ${repo} cortex hook-context`;
  const hookCaptureCmd = `pnpm -C ${repo} cortex hook-capture`;
  return {
    repo,
    home: homedir(),
    apply,
    toolbelt: JSON.parse(readFileSync(join(repo, "config/toolbelt.json"), "utf8")) as Manifest,
    hookContextCmd,
    hookCaptureCmd,
    // Sintaxis anterior a B-1 (scripts de paquete `hook:context`/`hook:capture`, ya
    // RETIRADOS): `cortex sync --apply` la detecta en los hooks instalados y la sustituye
    // por la sintaxis del CLI. Imprescindible hasta que todo el equipo re-sincronice (un
    // hook con la sintaxis vieja ya no funciona: el script puente no existe).
    legacyHookCmds: [
      { old: `pnpm -C ${repo} --filter @cortex/core run hook:context`, now: hookContextCmd },
      { old: `pnpm -C ${repo} --filter @cortex/agents run hook:capture`, now: hookCaptureCmd },
    ],
  };
}

export function have(bin: string): boolean {
  try {
    execFileSync("/bin/sh", ["-c", `command -v ${bin}`], { stdio: "ignore" });
    return true;
  } catch {
    return false;
  }
}

export function plan(ctx: SyncCtx, msg: string): void {
  console.log(`  ${ctx.apply ? "✓" : "•"} ${msg}`);
}

export function symlink(ctx: SyncCtx, src: string, dest: string): void {
  plan(ctx, `symlink ${dest.replace(ctx.home, "~")} → ${src.replace(ctx.repo, ".")}`);
  if (!ctx.apply) return;
  mkdirSync(join(dest, ".."), { recursive: true });
  try {
    rmSync(dest, { recursive: true, force: true });
  } catch {}
  symlinkSync(src, dest);
}

export const resolveArgs = (ctx: SyncCtx, a: string[] = []): string[] => a.map((x) => x.replace("{REPO}", ctx.repo));

export const envPairs = (keys: string[] = []): (readonly [string, string])[] =>
  keys.filter((k) => process.env[k]).map((k) => [k, process.env[k]!] as const);

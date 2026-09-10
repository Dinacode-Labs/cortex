import { lstatSync, readlinkSync, rmSync } from "node:fs";
import { homeFile, readJson, tilde, writeJson } from "./fs.js";
import { hasCortexHooks, mergeHooks, removeHooks, type HookDef, type HooksHolder } from "./hooks-json.js";
import { emptyReport, type AgentAdapter, type AgentStatus, type SetupCtx, type SetupReport } from "./types.js";

/**
 * Claude Code. La vía preferente es el **plugin** (`plugin/claude-code/` en este mismo repo,
 * publicado como marketplace): trae hooks, MCP, skill y comando en un solo paquete, se
 * actualiza solo y el usuario lo ve y lo desactiva desde `/plugin`.
 *
 * El plugin depende de que Claude pueda clonar el marketplace, y este repo es privado: si el
 * dev no tiene acceso por `gh`/SSH, la instalación falla. En ese caso no se aborta — se cae
 * al modo `settings.json`, que hace lo mismo escribiendo hooks a mano. Es también lo que
 * fuerza `--no-plugin`.
 *
 * En los dos modos se limpia el legado: hooks `pnpm -C <repo> cortex hook-*`, el MCP
 * registrado como `pnpm --filter @cortex/mcp-server` (hablaba con Postgres directamente y sin
 * permisos) y los symlinks de skill/comando que apuntaban al clon.
 */

export const MARKETPLACE = "dinacode-cortex";
export const MARKETPLACE_SOURCE = "Dinacode-Labs/cortex";
export const PLUGIN = `cortex@${MARKETPLACE}`;

const HOOK_DEFS: HookDef[] = [
  { event: "SessionStart", kind: "context", matcher: "startup|resume|clear|compact", command: "cortex hook-context", timeout: 20 },
  { event: "SessionEnd", kind: "capture", command: "cortex hook-capture", timeout: 30 },
  { event: "PreCompact", kind: "capture", command: "cortex hook-capture", timeout: 30 },
];

const settingsFile = (ctx: SetupCtx): string => homeFile(ctx, ".claude/settings.json");

/** Estado del MCP `cortex` en Claude: sin registrar, registrado bien, o con el comando viejo. */
function mcpState(ctx: SetupCtx): "missing" | "ok" | "legacy" {
  try {
    const out = ctx.exec("claude", ["mcp", "get", "cortex"]);
    return /^\s*Command:\s*cortex\s*$/m.test(out) ? "ok" : "legacy";
  } catch {
    return "missing";
  }
}

/** Symlinks que dejaba `cortex sync` apuntando al clon del repo: los aporta ya el plugin. */
function dropLegacyLinks(ctx: SetupCtx, report: SetupReport): void {
  for (const rel of [".claude/skills/cortex-capture", ".claude/commands/cortex-save.md"]) {
    const file = homeFile(ctx, rel);
    try {
      if (!lstatSync(file).isSymbolicLink()) continue;
      const target = readlinkSync(file);
      if (!target.includes("config/skills") && !target.includes("config/commands")) continue;
      if (!ctx.dryRun) rmSync(file, { force: true });
      report.changed.push(`old symlink removed (${tilde(ctx, file)}): the plugin provides it`);
    } catch {
      /* no existe: nada que limpiar */
    }
  }
}

/** Registra el MCP como `cortex mcp`, sustituyendo el registro viejo si lo hay. */
function ensureMcp(ctx: SetupCtx, report: SetupReport): void {
  const state = mcpState(ctx);
  if (state === "ok") {
    report.skipped.push("MCP `cortex` already registered as `cortex mcp`");
    return;
  }
  if (state === "legacy") {
    report.changed.push("MCP `cortex` pointed at the cloned repo — re-registering it against the server");
    if (!ctx.dryRun) {
      try {
        ctx.exec("claude", ["mcp", "remove", "cortex", "-s", "user"]);
      } catch {
        /* si no se puede quitar, el add de abajo dirá lo suyo */
      }
    }
  } else {
    report.changed.push("MCP `cortex` → `cortex mcp`");
  }
  if (ctx.dryRun) return;
  try {
    ctx.exec("claude", ["mcp", "add", "cortex", "-s", "user", "--", "cortex", "mcp"]);
  } catch (e) {
    report.warnings.push(`could not register the MCP: ${(e as Error).message}. Do it with: claude mcp add cortex -s user -- cortex mcp`);
  }
}

/** Escribe (o quita) los hooks de Cortex en ~/.claude/settings.json. */
function writeHooks(ctx: SetupCtx, report: SetupReport, mode: "install" | "uninstall"): void {
  const file = settingsFile(ctx);
  const obj = readJson<HooksHolder>(file);
  if (obj === null) {
    report.warnings.push(`${tilde(ctx, file)} is not valid JSON, so it was left alone. Fix the file, or add the hooks by hand.`);
    return;
  }
  const settings: HooksHolder = obj ?? {};
  if (mode === "install") {
    const res = mergeHooks(settings, HOOK_DEFS);
    if (res.replacedLegacy.length) report.changed.push(`${res.replacedLegacy.length} hook(s) from an older version updated`);
    if (res.changed.length === 0) {
      report.skipped.push("hooks in settings.json already up to date");
      return;
    }
    report.changed.push(...res.changed.map((c) => `hook ${c}`));
  } else {
    const res = removeHooks(settings);
    if (res.changed.length === 0) {
      report.skipped.push("there were no Cortex hooks in settings.json");
      return;
    }
    report.changed.push(...res.changed);
  }
  writeJson(ctx, file, settings);
}

function pluginInstalled(ctx: SetupCtx): boolean {
  const obj = readJson<{ plugins?: Record<string, unknown> }>(homeFile(ctx, ".claude/plugins/installed_plugins.json"));
  return Boolean(obj && obj.plugins && PLUGIN in obj.plugins);
}

/** Instala el plugin. Devuelve false si no se ha podido (repo privado sin acceso, CLI vieja…). */
function tryPlugin(ctx: SetupCtx, report: SetupReport): boolean {
  if (ctx.dryRun) {
    report.changed.push(`plugin ${PLUGIN} (marketplace ${MARKETPLACE_SOURCE}) — would install`);
    return true;
  }
  try {
    try {
      ctx.exec("claude", ["plugin", "marketplace", "add", MARKETPLACE_SOURCE]);
    } catch (e) {
      // «already exists» es el caso normal en la segunda ejecución.
      if (!/already exists|already added/i.test((e as Error).message)) throw e;
    }
    ctx.exec("claude", ["plugin", "install", PLUGIN, "--scope", "user", "--yes"]);
    report.changed.push(`plugin ${PLUGIN} installed (hooks, MCP, skill and /cortex-save)`);
    return true;
  } catch (e) {
    report.warnings.push(
      `could not install the plugin (${(e as Error).message.split("\n")[0]}). Falling back to hooks in settings.json; if you wanted the plugin, check you have access to ${MARKETPLACE_SOURCE}.`,
    );
    return false;
  }
}

export const claudeCodeAdapter: AgentAdapter = {
  id: "claude-code",
  bin: "claude",

  async apply(ctx: SetupCtx): Promise<SetupReport> {
    const report = emptyReport();
    const viaPlugin = ctx.noPlugin ? false : tryPlugin(ctx, report);

    if (viaPlugin) {
      // El plugin ya trae sus hooks y su MCP: dejarlos también en settings.json
      // significaría inyectar el contexto dos veces y destilar la sesión dos veces.
      writeHooks(ctx, report, "uninstall");
      if (mcpState(ctx) !== "missing") {
        report.changed.push("user-level MCP `cortex` removed: the plugin provides it");
        if (!ctx.dryRun) {
          try {
            ctx.exec("claude", ["mcp", "remove", "cortex", "-s", "user"]);
          } catch {
            report.warnings.push("there is a user-level MCP `cortex` as well as the plugin; remove it with: claude mcp remove cortex -s user");
          }
        }
      }
    } else {
      writeHooks(ctx, report, "install");
      ensureMcp(ctx, report);
    }

    dropLegacyLinks(ctx, report);
    return report;
  },

  async remove(ctx: SetupCtx): Promise<SetupReport> {
    const report = emptyReport();
    if (pluginInstalled(ctx)) {
      if (!ctx.dryRun) {
        try {
          ctx.exec("claude", ["plugin", "uninstall", PLUGIN]);
          report.changed.push(`plugin ${PLUGIN} uninstalled`);
        } catch (e) {
          report.warnings.push(`could not uninstall the plugin: ${(e as Error).message}`);
        }
      } else report.changed.push(`plugin ${PLUGIN} — would uninstall`);
    }
    writeHooks(ctx, report, "uninstall");
    if (mcpState(ctx) !== "missing") {
      report.changed.push("MCP `cortex` removed");
      if (!ctx.dryRun) {
        try {
          ctx.exec("claude", ["mcp", "remove", "cortex", "-s", "user"]);
        } catch {
          report.warnings.push("could not remove the MCP: claude mcp remove cortex -s user");
        }
      }
    }
    return report;
  },

  async status(ctx: SetupCtx): Promise<AgentStatus> {
    const details: string[] = [];
    const plugin = pluginInstalled(ctx);
    if (plugin) details.push(`plugin ${PLUGIN} installed`);
    const settings = readJson<HooksHolder>(settingsFile(ctx));
    const hooks = Boolean(settings && hasCortexHooks(settings));
    if (hooks) details.push("hooks in settings.json");
    const mcp = mcpState(ctx);
    details.push(mcp === "ok" ? "MCP `cortex mcp` registered" : mcp === "legacy" ? "MCP registered with the OLD command" : "MCP not registered");
    if (plugin && hooks) details.push("⚠️ both plugin and hooks: the session would be captured twice (run `cortex setup claude-code`)");
    return { installed: plugin || hooks, details };
  },
};

/** Existe solo para los tests: comprobar el plan de hooks sin pasar por el sistema de ficheros. */
export const CLAUDE_HOOK_DEFS = HOOK_DEFS;

export function claudeSettingsPath(ctx: SetupCtx): string {
  return settingsFile(ctx);
}

export const claudePluginInstalled = pluginInstalled;
export const claudeMcpState = mcpState;

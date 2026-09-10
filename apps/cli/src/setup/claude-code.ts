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
      report.changed.push(`symlink antiguo eliminado (${tilde(ctx, file)}): lo aporta el plugin`);
    } catch {
      /* no existe: nada que limpiar */
    }
  }
}

/** Registra el MCP como `cortex mcp`, sustituyendo el registro viejo si lo hay. */
function ensureMcp(ctx: SetupCtx, report: SetupReport): void {
  const state = mcpState(ctx);
  if (state === "ok") {
    report.skipped.push("MCP `cortex` ya registrado con `cortex mcp`");
    return;
  }
  if (state === "legacy") {
    report.changed.push("MCP `cortex` registrado contra el repo clonado — se vuelve a registrar contra el servidor");
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
    report.warnings.push(`no se pudo registrar el MCP: ${(e as Error).message}. Hazlo con: claude mcp add cortex -s user -- cortex mcp`);
  }
}

/** Escribe (o quita) los hooks de Cortex en ~/.claude/settings.json. */
function writeHooks(ctx: SetupCtx, report: SetupReport, mode: "install" | "uninstall"): void {
  const file = settingsFile(ctx);
  const obj = readJson<HooksHolder>(file);
  if (obj === null) {
    report.warnings.push(`${tilde(ctx, file)} no es JSON válido — no lo toco. Añade los hooks a mano o arregla el fichero.`);
    return;
  }
  const settings: HooksHolder = obj ?? {};
  if (mode === "install") {
    const res = mergeHooks(settings, HOOK_DEFS);
    if (res.replacedLegacy.length) report.changed.push(`${res.replacedLegacy.length} hook(s) de una versión anterior actualizados`);
    if (res.changed.length === 0) {
      report.skipped.push("hooks en settings.json ya al día");
      return;
    }
    report.changed.push(...res.changed.map((c) => `hook ${c}`));
  } else {
    const res = removeHooks(settings);
    if (res.changed.length === 0) {
      report.skipped.push("no había hooks de Cortex en settings.json");
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
    report.changed.push(`plugin ${PLUGIN} (marketplace ${MARKETPLACE_SOURCE}) — instalar`);
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
    report.changed.push(`plugin ${PLUGIN} instalado (hooks, MCP, skill y /cortex-save)`);
    return true;
  } catch (e) {
    report.warnings.push(
      `no se pudo instalar el plugin (${(e as Error).message.split("\n")[0]}). Configuro los hooks en settings.json; si querías el plugin, comprueba que tienes acceso a ${MARKETPLACE_SOURCE}.`,
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
        report.changed.push("MCP `cortex` de usuario eliminado: lo sirve el plugin");
        if (!ctx.dryRun) {
          try {
            ctx.exec("claude", ["mcp", "remove", "cortex", "-s", "user"]);
          } catch {
            report.warnings.push("hay un MCP `cortex` de usuario además del plugin; quítalo con: claude mcp remove cortex -s user");
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
          report.changed.push(`plugin ${PLUGIN} desinstalado`);
        } catch (e) {
          report.warnings.push(`no se pudo desinstalar el plugin: ${(e as Error).message}`);
        }
      } else report.changed.push(`plugin ${PLUGIN} — desinstalar`);
    }
    writeHooks(ctx, report, "uninstall");
    if (mcpState(ctx) !== "missing") {
      report.changed.push("MCP `cortex` eliminado");
      if (!ctx.dryRun) {
        try {
          ctx.exec("claude", ["mcp", "remove", "cortex", "-s", "user"]);
        } catch {
          report.warnings.push("no se pudo quitar el MCP: claude mcp remove cortex -s user");
        }
      }
    }
    return report;
  },

  async status(ctx: SetupCtx): Promise<AgentStatus> {
    const details: string[] = [];
    const plugin = pluginInstalled(ctx);
    if (plugin) details.push(`plugin ${PLUGIN} instalado`);
    const settings = readJson<HooksHolder>(settingsFile(ctx));
    const hooks = Boolean(settings && hasCortexHooks(settings));
    if (hooks) details.push("hooks en settings.json");
    const mcp = mcpState(ctx);
    details.push(mcp === "ok" ? "MCP `cortex mcp` registrado" : mcp === "legacy" ? "MCP registrado con el comando ANTIGUO" : "MCP no registrado");
    if (plugin && hooks) details.push("⚠️ plugin y hooks a la vez: la sesión se capturaría dos veces (ejecuta `cortex setup claude-code`)");
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

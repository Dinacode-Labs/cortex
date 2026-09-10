import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { claudeCodeAdapter } from "../apps/cli/src/setup/claude-code.js";
import { runSetup } from "../apps/cli/src/setup/index.js";
import type { SetupCtx } from "../apps/cli/src/setup/types.js";

/**
 * `cortex setup claude-code` escribe en ficheros que el dev ha configurado a mano y ejecuta
 * el CLI de Claude. Aquí no se ejecuta nada de verdad: el HOME es temporal y `exec` es un
 * espía, así que lo que se comprueba es exactamente lo que le pasaría a la máquina de alguien.
 *
 * Los casos que importan son los feos: un settings.json con hooks ajenos, un hook nuestro de
 * la época del clon del monorepo, un `claude plugin install` que falla porque el repo es
 * privado, y desinstalar sin llevarse por delante lo que no es nuestro.
 */

let home: string;
let calls: string[][];

function ctxWith(over: Partial<SetupCtx> = {}): SetupCtx {
  return {
    home,
    dryRun: false,
    remove: false,
    noPlugin: false,
    log: () => {},
    detect: () => true,
    exec: (bin, args) => {
      calls.push([bin, ...args]);
      return "";
    },
    now: () => new Date("2026-09-10T12:00:00Z"),
    ...over,
  };
}

const settingsPath = (): string => join(home, ".claude/settings.json");
const readSettings = (): Record<string, any> => JSON.parse(readFileSync(settingsPath(), "utf8"));

function writeSettings(obj: unknown): void {
  mkdirSync(join(home, ".claude"), { recursive: true });
  writeFileSync(settingsPath(), JSON.stringify(obj, null, 2));
}

const backups = (): string[] => (existsSync(join(home, ".claude")) ? readdirSync(join(home, ".claude")).filter((f) => f.includes(".bak-")) : []);

beforeEach(() => {
  home = mkdtempSync(join(tmpdir(), "cortex-setup-"));
  calls = [];
});
afterEach(() => rmSync(home, { recursive: true, force: true }));

describe("cortex setup claude-code (modo settings)", () => {
  it("instalación limpia: hooks de sesión + MCP registrado contra el servidor", async () => {
    const ctx = ctxWith({ noPlugin: true });
    const report = await claudeCodeAdapter.apply(ctx);

    const hooks = readSettings().hooks;
    expect(Object.keys(hooks)).toEqual(["SessionStart", "SessionEnd", "PreCompact"]);
    expect(hooks.SessionStart[0].matcher).toBe("startup|resume|clear|compact");
    expect(hooks.SessionStart[0].hooks[0].command).toBe("cortex hook-context");
    expect(hooks.SessionEnd[0].hooks[0].command).toBe("cortex hook-capture");
    // PreCompact además de SessionEnd: el SessionEnd de Claude tiene timeout y a veces no llega.
    expect(hooks.PreCompact[0].hooks[0].command).toBe("cortex hook-capture");

    expect(calls).toContainEqual(["claude", "mcp", "add", "cortex", "-s", "user", "--", "cortex", "mcp"]);
    expect(report.warnings).toHaveLength(0);
  });

  it("no toca los hooks del usuario y guarda copia antes de escribir", async () => {
    writeSettings({ hooks: { PreToolUse: [{ matcher: "Bash", hooks: [{ type: "command", command: "audit.sh" }] }] }, model: "opus" });
    await claudeCodeAdapter.apply(ctxWith({ noPlugin: true }));

    const s = readSettings();
    expect(s.model).toBe("opus");
    expect(s.hooks.PreToolUse[0].hooks[0].command).toBe("audit.sh");
    expect(backups()).toHaveLength(1);
  });

  it("sustituye el hook de la instalación antigua en vez de duplicarlo", async () => {
    writeSettings({
      hooks: {
        SessionStart: [{ hooks: [{ type: "command", command: "pnpm -C /Users/x/.dinacode-cortex cortex hook-context" }] }],
        SessionEnd: [{ hooks: [{ type: "command", command: "pnpm -C /Users/x/.dinacode-cortex cortex hook-capture" }] }],
      },
    });
    const report = await claudeCodeAdapter.apply(ctxWith({ noPlugin: true }));

    const hooks = readSettings().hooks;
    expect(hooks.SessionStart.flatMap((g: any) => g.hooks)).toHaveLength(1);
    expect(hooks.SessionStart[0].hooks[0].command).toBe("cortex hook-context");
    expect(hooks.SessionEnd[0].hooks[0].command).toBe("cortex hook-capture");
    expect(report.changed.join(" ")).toContain("versión anterior");
  });

  it("--dry-run no escribe nada ni ejecuta nada", async () => {
    const report = await claudeCodeAdapter.apply(ctxWith({ noPlugin: true, dryRun: true }));
    expect(existsSync(settingsPath())).toBe(false);
    expect(calls.filter((c) => c[1] === "mcp" && c[2] === "add")).toHaveLength(0);
    expect(report.changed.length).toBeGreaterThan(0);
  });

  it("re-registra el MCP si apuntaba al repo clonado", async () => {
    const ctx = ctxWith({
      noPlugin: true,
      exec: (bin, args) => {
        calls.push([bin, ...args]);
        if (args[0] === "mcp" && args[1] === "get") return "cortex:\n  Command: pnpm\n  Args: -C /repo --filter @cortex/mcp-server start\n";
        return "";
      },
    });
    const report = await claudeCodeAdapter.apply(ctx);
    expect(calls).toContainEqual(["claude", "mcp", "remove", "cortex", "-s", "user"]);
    expect(calls).toContainEqual(["claude", "mcp", "add", "cortex", "-s", "user", "--", "cortex", "mcp"]);
    expect(report.changed.join(" ")).toContain("repo clonado");
  });

  it("si el MCP ya está bien registrado, no lo vuelve a tocar", async () => {
    const ctx = ctxWith({
      noPlugin: true,
      exec: (bin, args) => {
        calls.push([bin, ...args]);
        if (args[0] === "mcp" && args[1] === "get") return "cortex:\n  Type: stdio\n  Command: cortex\n  Args: mcp\n";
        return "";
      },
    });
    const report = await claudeCodeAdapter.apply(ctx);
    expect(calls.some((c) => c[2] === "add")).toBe(false);
    expect(report.skipped.join(" ")).toContain("ya registrado");
  });

  it("un settings.json roto se deja en paz y se avisa", async () => {
    mkdirSync(join(home, ".claude"), { recursive: true });
    writeFileSync(settingsPath(), "{ esto no es json");
    const report = await claudeCodeAdapter.apply(ctxWith({ noPlugin: true }));
    expect(readFileSync(settingsPath(), "utf8")).toBe("{ esto no es json");
    expect(report.warnings.join(" ")).toContain("JSON");
  });
});

describe("cortex setup claude-code (modo plugin)", () => {
  it("con el plugin instalado, no deja hooks en settings: capturaría dos veces", async () => {
    writeSettings({ hooks: { SessionStart: [{ hooks: [{ type: "command", command: "pnpm -C /repo cortex hook-context" }] }] } });
    const report = await claudeCodeAdapter.apply(ctxWith());

    expect(calls).toContainEqual(["claude", "plugin", "marketplace", "add", "Dinacode-Labs/cortex"]);
    expect(calls).toContainEqual(["claude", "plugin", "install", "cortex@dinacode-cortex", "--scope", "user", "--yes"]);
    expect(readSettings().hooks).toBeUndefined();
    expect(report.changed.join(" ")).toContain("plugin");
  });

  it("si el marketplace no está accesible, cae a settings.json y avisa", async () => {
    const ctx = ctxWith({
      exec: (bin, args) => {
        calls.push([bin, ...args]);
        if (args[0] === "plugin") throw new Error("failed to clone repository: permission denied");
        return "";
      },
    });
    const report = await claudeCodeAdapter.apply(ctx);
    expect(report.warnings.join(" ")).toContain("plugin");
    // Lo importante: el dev acaba con Cortex funcionando igual.
    expect(readSettings().hooks.SessionStart[0].hooks[0].command).toBe("cortex hook-context");
    expect(calls).toContainEqual(["claude", "mcp", "add", "cortex", "-s", "user", "--", "cortex", "mcp"]);
  });
});

describe("cortex setup claude-code --remove", () => {
  it("quita lo de Cortex y conserva lo demás", async () => {
    writeSettings({ hooks: { PreToolUse: [{ hooks: [{ type: "command", command: "audit.sh" }] }] }, model: "opus" });
    await claudeCodeAdapter.apply(ctxWith({ noPlugin: true }));
    await claudeCodeAdapter.remove(ctxWith({ remove: true }));

    const s = readSettings();
    expect(s.model).toBe("opus");
    expect(s.hooks.PreToolUse[0].hooks[0].command).toBe("audit.sh");
    expect(s.hooks.SessionStart).toBeUndefined();
    expect(s.hooks.SessionEnd).toBeUndefined();
  });
});

describe("limpieza de la instalación anterior", () => {
  it("borra el shim de ~/.local/bin y avisa del clon, sin borrarlo", async () => {
    mkdirSync(join(home, ".local/bin"), { recursive: true });
    const shim = join(home, ".local/bin/cortex");
    writeFileSync(shim, `#!/bin/sh\nexec pnpm -C "$HOME/.dinacode-cortex" exec tsx apps/cli/src/index.ts "$@"\n`);
    mkdirSync(join(home, ".dinacode-cortex"), { recursive: true });

    const results = await runSetup(["claude-code"], ctxWith({ noPlugin: true }));
    const sistema = results.find((r) => r.id === "sistema")!;
    expect(existsSync(shim)).toBe(false);
    expect(sistema.report.changed.join(" ")).toContain("shim antiguo");
    // El clon puede tener un .env con claves: se avisa, no se borra.
    expect(existsSync(join(home, ".dinacode-cortex"))).toBe(true);
    expect(sistema.report.warnings.join(" ")).toContain(".dinacode-cortex");
  });

  it("borra los symlinks de skill y comando que apuntaban al clon", async () => {
    const repo = join(home, "repo");
    mkdirSync(join(repo, "config/skills/cortex-capture"), { recursive: true });
    mkdirSync(join(repo, "config/commands"), { recursive: true });
    writeFileSync(join(repo, "config/commands/cortex-save.md"), "x");
    mkdirSync(join(home, ".claude/skills"), { recursive: true });
    mkdirSync(join(home, ".claude/commands"), { recursive: true });
    symlinkSync(join(repo, "config/skills/cortex-capture"), join(home, ".claude/skills/cortex-capture"));
    symlinkSync(join(repo, "config/commands/cortex-save.md"), join(home, ".claude/commands/cortex-save.md"));

    await claudeCodeAdapter.apply(ctxWith({ noPlugin: true }));
    expect(existsSync(join(home, ".claude/skills/cortex-capture"))).toBe(false);
    expect(existsSync(join(home, ".claude/commands/cortex-save.md"))).toBe(false);
  });
});

describe("status", () => {
  it("avisa si conviven plugin y hooks (la sesión se capturaría dos veces)", async () => {
    mkdirSync(join(home, ".claude/plugins"), { recursive: true });
    writeFileSync(
      join(home, ".claude/plugins/installed_plugins.json"),
      JSON.stringify({ version: 2, plugins: { "cortex@dinacode-cortex": [{ scope: "user" }] } }),
    );
    await claudeCodeAdapter.apply(ctxWith({ noPlugin: true })); // deja hooks en settings
    const st = await claudeCodeAdapter.status(ctxWith());
    expect(st.installed).toBe(true);
    expect(st.details.join(" ")).toContain("dos veces");
  });
});

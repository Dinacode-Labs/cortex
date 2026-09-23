import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { claudeCodeAdapter } from "../apps/cli/src/setup/claude-code.js";
import { runSetup } from "../apps/cli/src/setup/index.js";
import type { SetupCtx } from "../apps/cli/src/setup/types.js";

/**
 * `cortex setup claude-code` writes into files the dev configured by hand and runs Claude's
 * CLI. Nothing is really executed here: HOME is temporary and `exec` is a spy, so what is
 * checked is exactly what would happen to somebody's machine.
 *
 * The cases that matter are the ugly ones: a settings.json with somebody else's hooks, one of
 * our hooks from the monorepo-clone era, a `claude plugin install` that fails because the repo
 * is private, and uninstalling without taking down what is not ours.
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
  it("clean install: session hooks plus an MCP registered against the server", async () => {
    const ctx = ctxWith({ noPlugin: true });
    const report = await claudeCodeAdapter.apply(ctx);

    const hooks = readSettings().hooks;
    expect(Object.keys(hooks)).toEqual(["SessionStart", "UserPromptSubmit", "SessionEnd", "PreCompact"]);
    expect(hooks.UserPromptSubmit[0].hooks[0]).toEqual({ type: "command", command: "cortex hook-lookup", timeout: 5 });
    expect(hooks.SessionStart[0].matcher).toBe("startup|resume|clear|compact");
    expect(hooks.SessionStart[0].hooks[0].command).toBe("cortex hook-context");
    expect(hooks.SessionEnd[0].hooks[0].command).toBe("cortex hook-capture");
    // PreCompact as well as SessionEnd: Claude's SessionEnd has a timeout and sometimes never arrives.
    expect(hooks.PreCompact[0].hooks[0].command).toBe("cortex hook-capture");

    expect(calls).toContainEqual(["claude", "mcp", "add", "cortex", "-s", "user", "--", "cortex", "mcp"]);
    expect(report.warnings).toHaveLength(0);
  });

  it("does not touch the user's hooks and takes a backup before writing", async () => {
    writeSettings({ hooks: { PreToolUse: [{ matcher: "Bash", hooks: [{ type: "command", command: "audit.sh" }] }] }, model: "opus" });
    await claudeCodeAdapter.apply(ctxWith({ noPlugin: true }));

    const s = readSettings();
    expect(s.model).toBe("opus");
    expect(s.hooks.PreToolUse[0].hooks[0].command).toBe("audit.sh");
    expect(backups()).toHaveLength(1);
  });

  it("replaces the old installation's hook instead of duplicating it", async () => {
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
    expect(report.changed.join(" ")).toContain("older version");
  });

  it("--dry-run writes nothing and runs nothing", async () => {
    const report = await claudeCodeAdapter.apply(ctxWith({ noPlugin: true, dryRun: true }));
    expect(existsSync(settingsPath())).toBe(false);
    expect(calls.filter((c) => c[1] === "mcp" && c[2] === "add")).toHaveLength(0);
    expect(report.changed.length).toBeGreaterThan(0);
  });

  it("re-registers the MCP when it pointed at the cloned repo", async () => {
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
    expect(report.changed.join(" ")).toContain("cloned repo");
  });

  it("when the MCP is already registered correctly, it is left alone", async () => {
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
    expect(report.skipped.join(" ")).toContain("already registered");
  });

  it("a broken settings.json is left in peace and reported", async () => {
    mkdirSync(join(home, ".claude"), { recursive: true });
    writeFileSync(settingsPath(), "{ this is not json");
    const report = await claudeCodeAdapter.apply(ctxWith({ noPlugin: true }));
    expect(readFileSync(settingsPath(), "utf8")).toBe("{ this is not json");
    expect(report.warnings.join(" ")).toContain("JSON");
  });
});

describe("cortex setup claude-code (modo plugin)", () => {
  it("with the plugin installed, it leaves no hooks in settings: it would capture twice", async () => {
    writeSettings({ hooks: { SessionStart: [{ hooks: [{ type: "command", command: "pnpm -C /repo cortex hook-context" }] }] } });
    const report = await claudeCodeAdapter.apply(ctxWith());

    expect(calls).toContainEqual(["claude", "plugin", "marketplace", "add", "Dinacode-Labs/cortex"]);
    expect(calls).toContainEqual(["claude", "plugin", "install", "cortex@dinacode-cortex", "--scope", "user", "--yes"]);
    expect(readSettings().hooks).toBeUndefined();
    expect(report.changed.join(" ")).toContain("plugin");
  });

  it("when the marketplace is unreachable, it falls back to settings.json and says so", async () => {
    const ctx = ctxWith({
      exec: (bin, args) => {
        calls.push([bin, ...args]);
        if (args[0] === "plugin") throw new Error("failed to clone repository: permission denied");
        return "";
      },
    });
    const report = await claudeCodeAdapter.apply(ctx);
    expect(report.warnings.join(" ")).toContain("plugin");
    // The point: the dev ends up with Cortex working all the same.
    expect(readSettings().hooks.SessionStart[0].hooks[0].command).toBe("cortex hook-context");
    expect(calls).toContainEqual(["claude", "mcp", "add", "cortex", "-s", "user", "--", "cortex", "mcp"]);
  });
});

describe("cortex setup claude-code --remove", () => {
  it("removes Cortex's and keeps the rest", async () => {
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

describe("cleanup of the previous installation", () => {
  it("deletes the ~/.local/bin shim and reports the clone, without deleting it", async () => {
    mkdirSync(join(home, ".local/bin"), { recursive: true });
    const shim = join(home, ".local/bin/cortex");
    writeFileSync(shim, `#!/bin/sh\nexec pnpm -C "$HOME/.dinacode-cortex" exec tsx apps/cli/src/index.ts "$@"\n`);
    mkdirSync(join(home, ".dinacode-cortex"), { recursive: true });

    const results = await runSetup(["claude-code"], ctxWith({ noPlugin: true }));
    const sistema = results.find((r) => r.id === "sistema")!;
    expect(existsSync(shim)).toBe(false);
    expect(sistema.report.changed.join(" ")).toContain("old shim removed");
    // The clone may hold a .env with keys: it is reported, not deleted.
    expect(existsSync(join(home, ".dinacode-cortex"))).toBe(true);
    expect(sistema.report.warnings.join(" ")).toContain(".dinacode-cortex");
  });

  it("deletes the skill and command symlinks that pointed at the clone", async () => {
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
  it("warns when plugin and hooks coexist (the session would be captured twice)", async () => {
    mkdirSync(join(home, ".claude/plugins"), { recursive: true });
    writeFileSync(
      join(home, ".claude/plugins/installed_plugins.json"),
      JSON.stringify({ version: 2, plugins: { "cortex@dinacode-cortex": [{ scope: "user" }] } }),
    );
    await claudeCodeAdapter.apply(ctxWith({ noPlugin: true }));
    const st = await claudeCodeAdapter.status(ctxWith());
    expect(st.installed).toBe(true);
    expect(st.details.join(" ")).toContain("captured twice");
  });
});

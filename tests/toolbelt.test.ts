import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { parse as yamlParse } from "yaml";
import { auditToolbelt, installToolbelt } from "../apps/cli/src/toolbelt/install.js";
import { loadRegistry, missingEnv, resolveArgs } from "../apps/cli/src/toolbelt/registry.js";
import type { SetupCtx } from "../apps/cli/src/setup/types.js";

/**
 * The toolbelt distributes third-party tool configuration. What matters is not that it
 * installs, but what it does when it CANNOT: an entry missing its environment variable has to
 * stay out, not get half-registered. A registered, broken MCP is worse than an absent one,
 * because the agent tries it on every start.
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
      if (args[0] === "mcp" && args[1] === "get") throw new Error("not found");
      return "";
    },
    now: () => new Date("2026-09-10T12:00:00Z"),
    ...over,
  };
}

const REGISTRY = {
  mcpServers: {
    tickets: { transport: "stdio" as const, command: "npx", args: ["-y", "tickets-mcp"], env: ["TICKETS_API_KEY"], auth: "a token in TICKETS_API_KEY" },
    wiki: { transport: "http" as const, url: "https://mcp.example.com/wiki", auth: "OAuth" },
    internal: { transport: "stdio" as const, command: "node", args: ["{REPO}/tools/x.js"], auth: "none" },
    claudeOnly: { transport: "stdio" as const, command: "foo", agents: ["claude"], auth: "none" },
  },
  skills: [{ name: "tickets-api", auth: "the MCP's" }],
  commands: [{ name: "new-ticket", file: "new-ticket.md" }],
};

beforeEach(() => {
  home = mkdtempSync(join(tmpdir(), "cortex-toolbelt-"));
  calls = [];
  process.env.TICKETS_API_KEY = "secret";
});
afterEach(() => {
  rmSync(home, { recursive: true, force: true });
  delete process.env.TICKETS_API_KEY;
});

describe("registry", () => {
  it("loads a local file and fills in whichever lists are missing", async () => {
    const f = join(home, "reg.json");
    writeFileSync(f, JSON.stringify({ mcpServers: { a: { transport: "stdio", command: "x" } } }));
    const m = await loadRegistry(f);
    expect(Object.keys(m.mcpServers)).toEqual(["a"]);
    expect(m.skills).toEqual([]);
    expect(m.commands).toEqual([]);
  });

  it("an unreadable registry fails with a message naming the file", async () => {
    await expect(loadRegistry(join(home, "does-not-exist.json"))).rejects.toThrow(/does-not-exist\.json/);
  });

  it("{REPO} without --repo leaves the entry unresolved", () => {
    expect(resolveArgs(["{REPO}/x.js"], null)).toBeNull();
    expect(resolveArgs(["{REPO}/x.js"], "/repo")).toEqual(["/repo/x.js"]);
    expect(resolveArgs(["no-placeholder"], null)).toEqual(["no-placeholder"]);
  });

  it("says which variables are missing", () => {
    expect(missingEnv({ transport: "stdio", env: ["TICKETS_API_KEY"] })).toEqual([]);
    expect(missingEnv({ transport: "stdio", env: ["NOT_EXPORTED_XYZ"] })).toEqual(["NOT_EXPORTED_XYZ"]);
  });
});

describe("installToolbelt", () => {
  it("skips the entries with no credentials instead of registering them broken", () => {
    delete process.env.TICKETS_API_KEY;
    const report = installToolbelt(ctxWith(), "opencode", REGISTRY, null);
    expect(report.warnings.join(" ")).toContain("TICKETS_API_KEY");
    const cfg = JSON.parse(readFileSync(join(home, ".config/opencode/opencode.json"), "utf8"));
    expect(cfg.mcp.tickets).toBeUndefined();
    expect(cfg.mcp.wiki).toBeDefined(); // the one that can be installed, is
  });

  it("respects the registry's agent filter", () => {
    const report = installToolbelt(ctxWith(), "opencode", REGISTRY, null);
    expect(report.changed.join(" ")).not.toContain("claudeOnly");
    const claude = installToolbelt(ctxWith(), "claude-code", REGISTRY, null);
    expect(claude.changed.join(" ")).toContain("claudeOnly");
  });

  it("does not overwrite an MCP that was already there: its auth may be done", () => {
    mkdirSync(join(home, ".config/opencode"), { recursive: true });
    writeFileSync(join(home, ".config/opencode/opencode.json"), JSON.stringify({ mcp: { wiki: { type: "remote", url: "https://mine", enabled: true } } }));
    const report = installToolbelt(ctxWith(), "opencode", REGISTRY, null);
    expect(JSON.parse(readFileSync(join(home, ".config/opencode/opencode.json"), "utf8")).mcp.wiki.url).toBe("https://mine");
    expect(report.skipped.join(" ")).toContain("wiki");
  });

  it("on Claude and Codex it uses their own CLI", () => {
    installToolbelt(ctxWith(), "claude-code", REGISTRY, null);
    expect(calls).toContainEqual(["claude", "mcp", "add", "tickets", "-s", "user", "-e", "TICKETS_API_KEY=secret", "--", "npx", "-y", "tickets-mcp"]);
    calls = [];
    installToolbelt(ctxWith(), "codex", REGISTRY, null);
    expect(calls.some((c) => c[0] === "codex" && c[2] === "add" && c[3] === "tickets")).toBe(true);
  });

  it("Hermes gets its YAML block", () => {
    installToolbelt(ctxWith(), "hermes", REGISTRY, null);
    const cfg = yamlParse(readFileSync(join(home, ".hermes/config.yaml"), "utf8")) as any;
    expect(cfg.mcp_servers.tickets).toEqual({ command: "npx", args: ["-y", "tickets-mcp"], enabled: true });
  });

  it("with no --repo, skills and commands are skipped with a warning (they are files)", () => {
    const report = installToolbelt(ctxWith(), "claude-code", REGISTRY, null);
    expect(report.warnings.join(" ")).toContain("--repo");
    expect(existsSync(join(home, ".claude/skills/tickets-api"))).toBe(false);
  });

  it("with --repo, it links skills and commands", () => {
    const repo = join(home, "registry");
    mkdirSync(join(repo, "skills/tickets-api"), { recursive: true });
    mkdirSync(join(repo, "commands"), { recursive: true });
    writeFileSync(join(repo, "commands/new-ticket.md"), "x");
    const report = installToolbelt(ctxWith(), "claude-code", REGISTRY, repo);
    expect(existsSync(join(home, ".claude/skills/tickets-api"))).toBe(true);
    expect(existsSync(join(home, ".claude/commands/new-ticket.md"))).toBe(true);
    // And with a repo, the entry that used {REPO} stops being skipped.
    expect(report.warnings.join(" ")).not.toContain("{REPO}");
  });

  it("--dry-run writes nothing", () => {
    installToolbelt(ctxWith({ dryRun: true }), "opencode", REGISTRY, null);
    expect(existsSync(join(home, ".config/opencode/opencode.json"))).toBe(false);
  });
});

describe("auditToolbelt", () => {
  it("only flags in red what is actually missing something", () => {
    delete process.env.TICKETS_API_KEY;
    const rows = auditToolbelt(REGISTRY);
    const tickets = rows.find((r) => r.line.startsWith("tickets"))!;
    expect(tickets.ok).toBe(false);
    expect(tickets.line).toContain("MISSING");
    expect(rows.find((r) => r.line.startsWith("wiki"))!.ok).toBe(true);
  });
});

import { describe, it, expect } from "vitest";
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

/**
 * The plugin is consumed by Claude Code, not by our code: if `marketplace.json` and
 * `plugin.json` stop lining up, or the `source` points at the wrong place, nobody finds out
 * until a dev runs `cortex setup` and it fails on them. These checks are the ones
 * `claude plugin validate` does, which is not available in CI.
 */
const root = resolve(import.meta.dirname, "..");
const read = <T>(rel: string): T => JSON.parse(readFileSync(resolve(root, rel), "utf8")) as T;

interface Marketplace {
  name: string;
  plugins: { name: string; source: string; version?: string }[];
}
interface Plugin {
  name: string;
  version: string;
  description: string;
}

describe("plugin de Claude Code", () => {
  const market = read<Marketplace>(".claude-plugin/marketplace.json");
  const entry = market.plugins.find((p) => p.name === "cortex")!;
  const plugin = read<Plugin>("plugin/claude-code/.claude-plugin/plugin.json");

  it("the marketplace points at a plugin folder that exists", () => {
    expect(market.name).toBe("dinacode-cortex");
    expect(entry).toBeDefined();
    expect(existsSync(resolve(root, entry.source, ".claude-plugin/plugin.json"))).toBe(true);
  });

  it("both versions move together (the release bumps both)", () => {
    expect(entry.version).toBe(plugin.version);
  });

  it("brings the loop's three hooks, and all three call the published CLI", () => {
    const hooks = read<{ hooks: Record<string, { hooks: { command: string; timeout?: number }[] }[]> }>(
      "plugin/claude-code/hooks/hooks.json",
    ).hooks;
    expect(Object.keys(hooks).sort()).toEqual(["PreCompact", "SessionEnd", "SessionStart"]);
    for (const [evento, grupos] of Object.entries(hooks)) {
      for (const h of grupos.flatMap((g) => g.hooks)) {
        // No paths into a repo clone: the hook uses the `cortex` on the PATH (ADR-0032)...
        expect(h.command, evento).toMatch(/\bcortex hook-(context|capture)\b/);
        expect(h.command, evento).not.toMatch(/\bpnpm\b|\btsx\b|dinacode-cortex/);
        // ...and when it is not installed, it does not blow up the agent's session.
        expect(h.command, evento).toContain("command -v cortex");
        expect(h.timeout, evento).toBeGreaterThan(0);
      }
    }
  });

  it("the plugin's MCP is the proxy, not the one that talked to Postgres", () => {
    const mcp = read<{ mcpServers: Record<string, { command: string; args: string[] }> }>("plugin/claude-code/.mcp.json");
    expect(mcp.mcpServers.cortex).toEqual({ command: "cortex", args: ["mcp"] });
  });

  it("the skill and the command live inside the plugin", () => {
    expect(existsSync(resolve(root, "plugin/claude-code/skills/cortex-capture/SKILL.md"))).toBe(true);
    expect(existsSync(resolve(root, "plugin/claude-code/commands/cortex-save.md"))).toBe(true);
  });
});

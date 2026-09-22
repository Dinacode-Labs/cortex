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

  /**
   * Both halves of the loop ship as skills. For a while only the write half did, and an agent
   * asked a question about the project had nothing to load: it answered out of `.claude/`.
   */
  it("the skills and the command live inside the plugin", () => {
    for (const skill of ["cortex-capture", "cortex-recall"]) {
      expect(existsSync(resolve(root, `plugin/claude-code/skills/${skill}/SKILL.md`)), skill).toBe(true);
    }
    expect(existsSync(resolve(root, "plugin/claude-code/commands/cortex-save.md"))).toBe(true);
  });

  /**
   * The skill used to say "when you finish a piece of work" and "do not save noise", and agents
   * almost never called the tool: nothing in it named a moment you could recognise while working.
   * What it has to carry now is a trigger list, the self-check, what NOT to save and one format.
   * A section that quietly disappears takes the protocol with it and nothing else fails.
   */
  it("the skill carries the whole protocol, and still fits in a session", () => {
    const skill = readFileSync(resolve(root, "plugin/claude-code/skills/cortex-capture/SKILL.md"), "utf8");
    for (const section of [/^## Triggers/m, /^## Self-check after every task/m, /^## Do NOT save/m, /^## Format/m]) {
      expect(skill, `missing section ${section}`).toMatch(section);
    }
    // The description is what makes it fire at all: it triggers on being asked, and on deciding.
    // Folded (`>-`), so a line break in it is a space once the frontmatter is parsed.
    const description = (/^description: >-\n([\s\S]*?)\n---/m.exec(skill)?.[1] ?? "").replace(/\s+/g, " ");
    for (const phrase of ["remember this", "record that decision", "decides"]) {
      expect(description, `the description does not trigger on "${phrase}"`).toContain(phrase);
    }
    // Spanish stays because the users write it: the confirmation is the trigger, not the language.
    expect(skill).toContain("vale");
    // A skill nobody reads to the end is a skill whose format section does not apply (120 lines).
    expect(skill.split("\n").length).toBeLessThanOrEqual(120);
  });

  /** The command is a shortcut into the skill, not a second, quietly different protocol. */
  it("/cortex-save points at the skill instead of restating the format", () => {
    const command = readFileSync(resolve(root, "plugin/claude-code/commands/cortex-save.md"), "utf8");
    expect(command).toContain("cortex-capture");
    expect(command).toMatch(/Format/);
    expect(command.split("\n").length).toBeLessThanOrEqual(20);
  });
});

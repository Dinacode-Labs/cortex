import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { AGENT_IDS } from "../apps/cli/src/setup/types.js";
import {
  CAPTURE_DO_NOT_SAVE,
  CAPTURE_READ_FIRST,
  CAPTURE_SELF_CHECK,
  CAPTURE_SKILL_POINTER,
  MCP_INSTRUCTIONS,
  captureTrigger,
  sessionMemoryHeader,
} from "../packages/shared/src/capture-protocol.js";

/**
 * Five entrypoints tell five agents when to write to the memory, and nothing made them say the
 * same thing: the skill listed four triggers, the session header was one line, and the MCP server
 * shipped no instructions at all. The result was agents that almost never saved through the tool,
 * while the entries that did come through it were the best ones in the database.
 *
 * What is checked here is that the wording has ONE source and that it still fits where it is
 * injected: a header that eats the context pack, or instructions long enough to be skimmed, are
 * both ways of losing the protocol without anything failing.
 */
const ROOT = resolve(import.meta.dirname, "..");
const read = (rel: string): string => readFileSync(resolve(ROOT, rel), "utf8");

describe("the capture protocol has one wording", () => {
  /**
   * The header shares the session's budget with the context pack (`CORTEX_HOOK_CTX_CHARS`, 8000).
   * Every character of preamble is one the pack does not get, and the pack is the part the agent
   * cannot work out by reading the code. It was 300 when the header carried the write half alone;
   * the read half is the rest, and `tests/lookup-protocol.test.ts` holds that end.
   */
  it("the session header says the four things in under 500 characters", () => {
    const header = sessionMemoryHeader("Cortex", "Acme Portal", { skill: true });
    expect(header.length).toBeLessThan(500);
    const lines = header.split("\n");
    expect(lines).toHaveLength(4); // title + what this is + when to read + when to write back
    expect(lines[1]).toMatch(/memory/i);
    expect(lines[2]).toContain(CAPTURE_READ_FIRST);
    expect(lines[3]).toBe(`${captureTrigger()} ${CAPTURE_SKILL_POINTER}`);
  });

  /**
   * The skill ships with the plugin, which only Claude Code and Codex install. Pi and OpenCode get
   * the same header through `--format text`, and an instruction to go and read something that is
   * not there teaches the agent to skim the two lines above it, which do apply.
   */
  it("only whoever has the plugin is sent to the skill", () => {
    expect(sessionMemoryHeader("Cortex", "p", { skill: true })).toContain(CAPTURE_SKILL_POINTER);
    expect(sessionMemoryHeader("Cortex", "p")).not.toContain("cortex-capture");
    expect(sessionMemoryHeader("Cortex", "p")).toContain(captureTrigger());
    // And the hook decides it by the output format, which is what tells the agents apart.
    expect(read("apps/cli/src/commands/hook-context.ts")).toContain('skill: format === "claude"');
  });

  it("the MCP instructions carry the trigger and the do-not-save list in under 600 characters", () => {
    expect(MCP_INSTRUCTIONS.length).toBeLessThan(600);
    expect(MCP_INSTRUCTIONS).toContain(captureTrigger());
    expect(MCP_INSTRUCTIONS).toContain(CAPTURE_DO_NOT_SAVE);
  });

  /** Pi renames the tool, so the sentence has to name the tool THAT agent has, not ours. */
  it("the trigger names the tool of whoever is reading it", () => {
    expect(captureTrigger()).toContain("`save_project_context`");
    expect(captureTrigger("cortex.mem_save")).toContain("`cortex.mem_save`");
    expect(captureTrigger("cortex.mem_save")).not.toContain("save_project_context");
  });

  /**
   * A carrier that writes its own version of the sentence is a carrier that drifts: the one-line
   * header this replaces said "capture what is new", which is not a trigger anybody can act on.
   */
  it.each([
    ["apps/cli/src/commands/hook-context.ts", "sessionMemoryHeader("],
    ["apps/mcp-server/src/server.ts", "MCP_INSTRUCTIONS"],
    ["apps/cli/src/mcp/proxy.ts", "MCP_INSTRUCTIONS"],
    ["apps/cli/src/setup/opencode.ts", "captureTrigger("],
    ["apps/cli/src/setup/pi.ts", "captureTrigger("],
  ])("%s takes the wording from @cortex/shared", (file, symbol) => {
    const src = read(file);
    expect(src).toContain(symbol);
    expect(src, "the sentence is written out by hand as well").not.toContain("When the user decides, confirms or corrects you");
  });

  /**
   * Every agent `cortex setup` supports has to hear the protocol from somewhere, and which file
   * that is differs per agent: Claude Code and Codex install the same plugin, OpenCode gets a
   * command, Pi a tool description, and Hermes has no text of its own at all — for it the session
   * header and the MCP's instructions are the only channel. Which agent is missing one is easy to
   * forget when the next agent is added, and nothing else would fail.
   */
  const CARRIERS: Record<string, string[]> = {
    "claude-code": ["plugin/claude-code/skills/cortex-capture/SKILL.md", "plugin/claude-code/commands/cortex-save.md"],
    codex: ["plugin/claude-code/skills/cortex-capture/SKILL.md"], // the same marketplace, the same plugin
    opencode: ["apps/cli/src/setup/opencode.ts"],
    pi: ["apps/cli/src/setup/pi.ts"],
    // No text of its own: the header and the MCP's instructions are its only channel, and the
    // instructions reach it through the proxy, which is the MCP every agent actually launches.
    hermes: ["apps/cli/src/commands/hook-context.ts", "apps/cli/src/mcp/proxy.ts"],
  };

  // The shared symbols by name. A looser `CAPTURE_` would also match `CAPTURE_CMD`, which is a
  // hook command and carries no protocol at all.
  const CARRIES = /captureTrigger\(|CAPTURE_DO_NOT_SAVE|CAPTURE_SELF_CHECK|MCP_INSTRUCTIONS|sessionMemoryHeader|## Self-check/;

  it("every agent setup supports has a file that carries the protocol", () => {
    expect(Object.keys(CARRIERS).sort()).toEqual([...AGENT_IDS].sort());
    const silent = Object.entries(CARRIERS).filter(([, files]) => !files.some((f) => CARRIES.test(read(f))));
    expect(silent.map(([agent]) => agent)).toEqual([]);
  });

  /**
   * The skill is the long form of the protocol: it has to quote the short form, not rephrase it.
   * Compared with the line breaks collapsed, because the markdown wraps at 100 columns and the
   * sentence still has to be one sentence.
   */
  it("the skill quotes the self-check and the do-not-save list verbatim", () => {
    const skill = read("plugin/claude-code/skills/cortex-capture/SKILL.md").replace(/[\s>]+/g, " ");
    expect(skill).toContain(CAPTURE_SELF_CHECK);
    expect(skill).toMatch(/## Do NOT save/);
    // The section opens the sentence, so it capitalises it: the wording is what has to match.
    expect(skill.toLowerCase()).toContain(CAPTURE_DO_NOT_SAVE.replace(/^Do not save /, "").toLowerCase());
  });
});

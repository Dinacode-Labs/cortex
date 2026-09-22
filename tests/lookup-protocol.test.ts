import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import {
  LOOKUP_SELF_CHECK,
  LOOKUP_SKILL_POINTER,
  LOOKUP_WHEN,
  MCP_INSTRUCTIONS,
  SEARCH_TOOL,
  lookupTrigger,
  packIsASample,
  packShowing,
  sessionMemoryHeader,
} from "../packages/shared/src/capture-protocol.js";
import { PACK_SECTIONS } from "../packages/core/src/context-pack.js";
import { renderContextPack } from "../packages/core/src/render.js";
import type { ContextPack } from "../packages/core/src/context-pack.js";
import type { ContextEntry } from "@cortex/shared";

/**
 * An agent opened a session with the pack injected, was asked something about the project,
 * recognised it as a question about the repository, found a coherent answer in `.claude/` and
 * stopped there. The entry it needed was in the part the pack had cut — the cut said so, in
 * italics, as `…and 11 more here. Ask Cortex for the rest.`, which names a brand and no tool and
 * reads as a footnote. Nothing failed; the answer was just the rules, with the experience missing.
 *
 * So what is checked here is that the material Cortex injects still asks for the lookup by itself:
 * that a truncated section says how many it dropped and which call brings them back, that the pack
 * says what fraction of the memory it is, and that every carrier of the protocol says the read half
 * and not only the write half. Wording is exactly the kind of thing that gets "tidied" back.
 */
const ROOT = resolve(import.meta.dirname, "..");
const read = (rel: string): string => readFileSync(resolve(ROOT, rel), "utf8");

const entry = (type: string, i: number): ContextEntry =>
  ({
    id: `${type}-${i}`,
    title: `${type} number ${i}`,
    content: "x".repeat(300),
    summary: "y".repeat(200),
    type,
    status: "active",
    confidence: "medium",
  }) as unknown as ContextEntry;

const pack = (perSection = 12, totalEntries = 349): ContextPack =>
  ({
    project: "Acme Portal",
    totalEntries,
    generatedAt: new Date("2026-09-22T00:00:00Z"),
    sections: PACK_SECTIONS.map((s) => ({
      ...s,
      entries: Array.from({ length: perSection }, (_, i) => entry(s.type, i)),
    })),
    sensitiveModules: ["payments", "auth"],
    relevantToArea: [],
    conflicts: [],
  }) as unknown as ContextPack;

/** The `- **+N more** not shown` lines of a rendered pack. */
const cuts = (text: string): string[] => text.split("\n").filter((l) => /\*\*\+\d+ more\*\*/.test(l));

describe("a truncated pack asks for the rest", () => {
  it("every section that cut says how many it dropped AND which call brings them back", () => {
    const text = renderContextPack(pack(), { maxChars: 8000 });
    const lines = cuts(text);
    expect(lines.length, "nothing was truncated: this pack no longer exercises the case").toBeGreaterThan(0);
    // Every offender, and the tool itself is named once in the header rather than eleven times.
    expect(lines.filter((l) => !/`type: "[a-z_]+"`/.test(l))).toEqual([]);
    expect(text.split("\n").slice(0, 3).join(" ")).toContain(SEARCH_TOOL);
  });

  /**
   * The count is the whole argument. "Some entries were left out" is a disclaimer; "240 more not
   * shown here" is a fact about the memory that an agent cannot read past.
   */
  it("the count is the real number left behind", () => {
    const text = renderContextPack(pack(12), { maxChars: 4000 });
    const shownPerSection = new Map<string, number>();
    let current = "";
    for (const line of text.split("\n")) {
      if (line.startsWith("## ")) current = line.slice(3);
      else if (/^- \*\*[a-z_]+ number \d+\*\*/.test(line)) shownPerSection.set(current, (shownPerSection.get(current) ?? 0) + 1);
      else {
        const left = /^- \*\*\+(\d+) more\*\*/.exec(line);
        if (left) expect(Number(left[1]), current).toBe(12 - (shownPerSection.get(current) ?? 0));
      }
    }
  });

  /**
   * A typed section hands over the argument that returns exactly that section, so the agent does
   * not have to guess a query. A filter naming a type the domain does not have is worse than none:
   * the call comes back empty and the agent concludes the memory is empty.
   */
  it("a typed section names a type the search tool accepts", () => {
    const text = renderContextPack(pack(), { maxChars: 8000 });
    const types = new Set(PACK_SECTIONS.map((s) => s.type as string));
    const named = [...text.matchAll(/`type: "([^"]+)"`/g)].map((m) => m[1]!);
    expect(named.length).toBeGreaterThan(0);
    expect(named.filter((t) => !types.has(t))).toEqual([]);
  });

  /** The old wording is the one that failed. If it comes back, it comes back knowingly. */
  it("the footnote wording does not come back", () => {
    for (const cap of [2000, 8000]) {
      expect(renderContextPack(pack(), { maxChars: cap })).not.toMatch(/Ask \w+ for the rest/);
    }
  });
});

describe("the pack says what fraction of the memory it is", () => {
  it("a capped pack says how many of how many it is showing, and what that means", () => {
    const text = renderContextPack(pack(12, 349), { maxChars: 8000 });
    const shown = (text.match(/^- \*\*[a-z_]+ number \d+\*\*/gm) ?? []).length;
    expect(text.split("\n")[1]).toContain(packShowing(shown, 349));
    expect(text.split("\n")[2]).toContain(packIsASample());
  });

  /**
   * And it does not lie in the other direction: an uncapped pack of everything the project has is
   * not a sample, and calling it one teaches the agent to ignore the line when it is true.
   */
  it("a pack holding everything does not call itself a sample", () => {
    const whole = renderContextPack(pack(12, 12 * PACK_SECTIONS.length), {});
    expect(whole).not.toContain("a sample of the memory");
    expect(whole.split("\n")[1]).toContain("in total");
  });

  it("the sample line names the tool, not the brand", () => {
    expect(packIsASample()).toContain(`\`${SEARCH_TOOL}\``);
    expect(packIsASample()).not.toMatch(/Ask \w+ for the rest/);
    expect(packShowing(25, 349)).toBe("Showing 25 of 349 entries");
  });

  /**
   * The header grew, and the splitting still has to respect the cap it was given. From 1500,
   * which is where an eleven-section pack stops being able to announce all eleven: below that the
   * floor is the titles themselves, and it was already so before this line existed.
   */
  it("the pack never goes over its cap, however you ask for it", () => {
    for (const cap of [1500, 2000, 3000, 6000, 8000, 20000, 40000]) {
      expect(renderContextPack(pack(), { maxChars: cap }).length, `cap ${cap}`).toBeLessThanOrEqual(cap);
    }
  });
});

describe("the read half reaches every agent", () => {
  /**
   * Pi renames its tools (`cortex.mem_search`), so the sentence has to name the tool THAT agent
   * has. A trigger pointing at a tool the reader does not have is a trigger it learns to skip.
   */
  it("the trigger names the tool of whoever is reading it", () => {
    expect(lookupTrigger()).toContain(`\`${SEARCH_TOOL}\``);
    expect(lookupTrigger("cortex.mem_search")).toContain("`cortex.mem_search`");
    expect(lookupTrigger("cortex.mem_search")).not.toContain(SEARCH_TOOL);
  });

  /**
   * The sentence that does the work is the second half: "the files hold the rules, the memory
   * holds what the project learned the hard way". Without it the trigger reads as advice and loses
   * to an answer the agent has already found in the tree — which is precisely what happened.
   */
  it("the trigger says why the repository is not enough", () => {
    expect(lookupTrigger()).toMatch(/repository/i);
    expect(lookupTrigger()).toMatch(/files hold the rules/i);
  });

  it("the session header carries both halves of the loop, inside its budget", () => {
    const header = sessionMemoryHeader("Cortex", "Acme Portal", { skill: true });
    // It was under 300 when it carried the write half only. The read half is the rest, and it
    // costs about one pack entry — which the pack was losing anyway to an agent that never asked.
    expect(header.length).toBeLessThan(500);
    expect(header).toContain(lookupTrigger());
    expect(header).toContain(LOOKUP_SKILL_POINTER);
  });

  /** Hermes and anyone with no plugin hear the protocol here and nowhere else. */
  it("the MCP instructions carry the lookup trigger, inside their budget", () => {
    expect(MCP_INSTRUCTIONS.length).toBeLessThan(600);
    expect(MCP_INSTRUCTIONS).toContain(lookupTrigger());
  });

  /**
   * A carrier that writes its own version of the sentence is a carrier that drifts. The capture
   * half learned this the expensive way (ADR-0066) and the read half starts out the same.
   */
  it.each([
    ["apps/cli/src/commands/hook-context.ts", "sessionMemoryHeader("],
    ["apps/mcp-server/src/server.ts", "LOOKUP_WHEN"],
    ["apps/cli/src/mcp/proxy.ts", "MCP_INSTRUCTIONS"],
    ["packages/core/src/render.ts", "packIsASample"],
  ])("%s takes the wording from @cortex/shared", (file, symbol) => {
    const src = read(file);
    expect(src).toContain(symbol);
    expect(src, "the sentence is written out by hand as well").not.toContain("the files hold the rules,");
  });
});

describe("the lookup skill", () => {
  const skill = read("plugin/claude-code/skills/cortex-recall/SKILL.md");
  const description = (/^description: >-\n([\s\S]*?)\n---/m.exec(skill)?.[1] ?? "").replace(/\s+/g, " ");

  /**
   * Both skills that shipped before this one were WRITE skills. Asked a question about the
   * project, an agent had nothing to load: the tools were there, and a tool is not a trigger.
   */
  it("the description fires on a question about the project, not only on being asked to look", () => {
    expect(description.length).toBeGreaterThan(0);
    for (const phrase of ["how this project does something", "why it is the way it is", "already decided"]) {
      expect(description, `the description does not trigger on "${phrase}"`).toContain(phrase);
    }
  });

  /**
   * The one sentence that would have prevented the incident: the agent found a coherent answer in
   * the repository and never asked what the project knew from experience. A description that does
   * not contradict "I already have an answer" never gets to fire.
   */
  it("the description fires even when the repository looks like it answers", () => {
    expect(description).toMatch(/even when the repository looks like it already answers/i);
    expect(description).toMatch(/\.claude\//);
  });

  it("the skill quotes the self-check verbatim", () => {
    expect(skill.replace(/[\s>]+/g, " ")).toContain(LOOKUP_SELF_CHECK);
  });

  /** Sections that quietly disappear take the protocol with them and nothing else fails. */
  it("the skill carries the whole protocol, and still fits in a session", () => {
    for (const section of [/^## Triggers/m, /^## Self-check before every answer/m, /^## Which tool/m, /^## If the tools are not loaded/m]) {
      expect(skill, `missing section ${section}`).toMatch(section);
    }
    expect(skill.split("\n").length).toBeLessThanOrEqual(120);
  });

  /**
   * The tools arrive deferred and the server may still be connecting when the first batch of calls
   * goes out. `ToolSearch` waits for a connecting server, so the honest instruction is to ask at
   * the start rather than to work around the wait — which is what the failed session did.
   */
  it("the skill says to load the tools in the first batch", () => {
    expect(skill).toContain("ToolSearch");
    expect(skill).toMatch(/first\*{0,2} batch/i);
  });

  /** The read tools are only worth naming if they are the ones the server actually registers. */
  it("every tool the skill sends you to is registered by the MCP server", () => {
    const server = read("apps/mcp-server/src/server.ts");
    const named = [...skill.matchAll(/`(?:mcp__[a-z_]+__)?((?:search|ask|get|list)_project_[a-z_]+)`/g)].map((m) => m[1]!);
    expect(new Set(named).size).toBeGreaterThan(2);
    expect([...new Set(named)].filter((t) => !server.includes(`registerTool(\n    "${t}"`))).toEqual([]);
  });
});

describe("the query tools say when to call them", () => {
  const server = read("apps/mcp-server/src/server.ts");

  /**
   * A tool described by its implementation ("hybrid search over the knowledge base") tells an agent
   * what it does and never tells it when. Both read tools were written that way, and neither was
   * called by an agent that had a question and an answer already in hand.
   */
  it("the read tools name an occasion, not only a mechanism", () => {
    expect(server).toContain("LOOKUP_WHEN");
    expect(LOOKUP_WHEN).toMatch(/Call it when/);
    const silent = ["get_project_context_pack", "list_project_decisions"].filter((tool) => {
      const at = server.indexOf(`registerTool(\n    "${tool}"`);
      return !/Read this before|Call it when/.test(server.slice(at, at + 900));
    });
    expect(silent).toEqual([]);
  });

  /** The pack's cut lines point at `search_project_context`; its own description has to admit it. */
  it("the pack tool says that what it returns is a sample", () => {
    const at = server.indexOf(`registerTool(\n    "get_project_context_pack"`);
    expect(server.slice(at, at + 900)).toMatch(/sample/);
    expect(server.slice(at, at + 900)).toContain(SEARCH_TOOL);
  });
});

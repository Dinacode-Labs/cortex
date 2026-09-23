import { spawn } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { firstPromptContext } from "../apps/cli/src/first-prompt.js";
import {
  CLAUDE_MCP_PREFIXES,
  READ_TOOLS,
  SAVE_TOOL,
  SEARCH_TOOL,
  firstPromptLookup,
  lookupTrigger,
  readToolsSelect,
} from "../packages/shared/src/capture-protocol.js";

/**
 * With the plugin's MCP tools deferred, agents asked the memory in most sessions but only rarely
 * BEFORE their first Bash/Read/Agent: loading the tool and then calling it lost to a Bash already
 * at hand. The lookup hook writes that first action out on the first prompt of a session
 * (ADR-0074). What breaks it in silence: speaking on every prompt, speaking with no project,
 * anything on stdout that is not the protocol, and a `select:` that names a tool that does not
 * exist or one that writes.
 */

const ROOT = resolve(import.meta.dirname, "..");
const CLI = join(ROOT, "apps/cli/src/index.ts");

let linked: string;
let unlinked: string;
let state: string;

beforeEach(() => {
  linked = mkdtempSync(join(tmpdir(), "cortex-lookup-linked-"));
  writeFileSync(join(linked, ".cortex.json"), JSON.stringify({ slug: "acme-portal" }));
  unlinked = mkdtempSync(join(tmpdir(), "cortex-lookup-unlinked-"));
  state = mkdtempSync(join(tmpdir(), "cortex-lookup-state-"));
});
afterEach(() => {
  for (const dir of [linked, unlinked, state]) rmSync(dir, { recursive: true, force: true });
});

describe("firstPromptContext", () => {
  it("speaks on the first prompt of a session and never again in it", () => {
    expect(firstPromptContext({ sessionId: "s1", cwd: linked, stateDir: state })).toBe(firstPromptLookup());
    expect(firstPromptContext({ sessionId: "s1", cwd: linked, stateDir: state })).toBeNull();
    expect(firstPromptContext({ sessionId: "s2", cwd: linked, stateDir: state })).not.toBeNull();
  });

  it("says nothing without a linked project, with `ignore`, or without a session id", () => {
    writeFileSync(join(unlinked, ".cortex.json"), JSON.stringify({ slug: "acme-portal", ignore: true }));
    expect(firstPromptContext({ sessionId: "s1", cwd: unlinked, stateDir: state })).toBeNull();
    expect(firstPromptContext({ sessionId: undefined, cwd: linked, stateDir: state })).toBeNull();
  });

  it("a session id cannot write its marker outside the state directory", () => {
    expect(firstPromptContext({ sessionId: "../../etc/x", cwd: linked, stateDir: state })).not.toBeNull();
    expect(firstPromptContext({ sessionId: "../../etc/x", cwd: linked, stateDir: state })).toBeNull();
  });

  it("Codex gets the order without the ToolSearch step it has no use for", () => {
    const text = firstPromptContext({ sessionId: "s1", cwd: linked, codex: true, stateDir: state })!;
    expect(text).toContain(`\`${SEARCH_TOOL}\``);
    expect(text).not.toContain("ToolSearch");
  });
});

describe("the first-prompt order", () => {
  it("loads exactly the four read tools, under both of Claude Code's prefixes", () => {
    const names = readToolsSelect().replace(/^select:/, "").split(",");
    const expected = CLAUDE_MCP_PREFIXES.flatMap((p) => READ_TOOLS.map((t) => p + t));
    expect(names.sort()).toEqual(expected.sort());
    expect(names).toHaveLength(8);
    expect(names.filter((n) => /save_|validate_|lint_/.test(n) || n.endsWith(SAVE_TOOL))).toEqual([]);
  });

  it("names the first action and what comes before it, in the shared wording", () => {
    const text = firstPromptLookup();
    expect(text).toContain(readToolsSelect());
    expect(text).toMatch(/before any Bash, Read/i);
    expect(text).toMatch(/before answering/i);
    expect(text).toContain(`\`${SEARCH_TOOL}\` with the user's own words`);
    expect(text).toContain(lookupTrigger());
  });

  it("the command takes the wording from @cortex/shared rather than writing it out", () => {
    for (const file of ["apps/cli/src/commands/hook-lookup.ts", "apps/cli/src/first-prompt.ts"]) {
      expect(readFileSync(join(ROOT, file), "utf8"), file).not.toMatch(/ToolSearch|mcp__|the files hold the rules/);
    }
  });
});

describe("the plugin registers it", () => {
  const hooks = JSON.parse(readFileSync(join(ROOT, "plugin/claude-code/hooks/hooks.json"), "utf8")).hooks;

  it("on UserPromptSubmit, guarded like the others, with a short timeout because it blocks the message", () => {
    const entries = (hooks.UserPromptSubmit ?? []).flatMap((g: { hooks: unknown[] }) => g.hooks);
    expect(entries).toEqual([{ type: "command", command: "command -v cortex >/dev/null 2>&1 && cortex hook-lookup || true", timeout: 5 }]);
  });
});

/**
 * The real CLI, as Claude Code calls it: JSON on stdin and the pipe closed. stdout is the agent's
 * protocol channel, so the whole of it is compared, not a substring. `TMPDIR` points the markers
 * at a directory of this test's own.
 */
function hook(input: object): Promise<{ code: number | null; out: string; err: string }> {
  return new Promise((done, fail) => {
    const child = spawn(process.execPath, ["--conditions=development", "--import", "tsx", CLI, "hook-lookup"], {
      cwd: ROOT,
      stdio: ["pipe", "pipe", "pipe"],
      env: { ...process.env, TMPDIR: state, CORTEX_SERVER_URL: "http://127.0.0.1:9" },
    });
    let out = "";
    let err = "";
    child.stdout.on("data", (d) => (out += String(d)));
    child.stderr.on("data", (d) => (err += String(d)));
    const cutoff = setTimeout(() => {
      child.kill("SIGKILL");
      fail(new Error("the hook did not finish"));
    }, 20_000);
    child.on("exit", (code) => {
      clearTimeout(cutoff);
      done({ code, out, err });
    });
    child.on("error", fail);
    child.stdin.end(JSON.stringify(input));
  });
}

describe("cortex hook-lookup", () => {
  it("the first prompt gets the protocol JSON and nothing else; the second gets nothing", async () => {
    const prompt = { session_id: "abc-123", cwd: linked, prompt: "how do we sort the memory page?", hook_event_name: "UserPromptSubmit" };
    const first = await hook(prompt);
    expect({ code: first.code, err: first.err }).toEqual({ code: 0, err: "" });
    expect(JSON.parse(first.out)).toEqual({
      hookSpecificOutput: { hookEventName: "UserPromptSubmit", additionalContext: firstPromptLookup() },
    });
    expect(await hook(prompt)).toEqual({ code: 0, out: "", err: "" });
  }, 60_000);

  it("in a folder with no linked project it emits not one byte", async () => {
    expect(await hook({ session_id: "abc-456", cwd: unlinked, prompt: "hello" })).toEqual({ code: 0, out: "", err: "" });
  }, 30_000);
});

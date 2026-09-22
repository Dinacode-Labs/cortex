import { getBrandName, sessionMemoryHeader } from "@cortex/shared";
import { apiGet, useProjectServer } from "@cortex/client";
import { readHookStdin } from "../hook-stdin.js";

/**
 * The CONTEXT INJECTION hook (Claude Code's SessionStart, and its equivalents). It reads the
 * hook's JSON from stdin (`cwd`), resolves the project (`.cortex.json`) and emits the project's
 * context pack as `additionalContext` so the agent starts already "knowing" the project. It
 * queries the authenticated API (permissions plus attribution); it does not use MCP (at
 * SessionStart it is not connected yet). With no project or no context, it emits nothing. See
 * research/hooks-integration.md.
 *
 * Usage: the hook invokes it with the JSON on stdin. By hand:
 * echo '{"cwd":"/path"}' | cortex hook-context
 */

/**
 * How much memory fits at the start of a session. It is a budget ASKED OF the server, not a
 * pair of scissors: the server splits it between sections so something from every kind of
 * knowledge arrives, rather than decisions and nothing else.
 *
 * It was 6,000 when the pack covered five types. It now covers eleven (ADR-0054), and 6,000
 * left four sections announced but empty. Measured on a real project of 349 entries, **8,000 is
 * the point where all eleven carry content**: 25 entries instead of 13, for 33% more budget.
 * That is ~2,000 tokens at the start of a session, which is cheap for the one thing the agent
 * cannot work out by reading the code.
 */
const MAX_CTX = Number(process.env.CORTEX_HOOK_CTX_CHARS ?? "8000");

function argOf(name: string): string | undefined {
  const i = process.argv.indexOf(name);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

/**
 * A `managed: false` command: it manages its own lifecycle. A hook must NEVER break the session
 * nor pollute stderr, so it swallows any error silently and exits with 0. (loadEnv is done by
 * the dispatcher before invoking the command.)
 */
export async function run(): Promise<void> {
  try {
    const format = (argOf("--format") || "claude").toLowerCase();
    // Whoever passes `--cwd` (Pi, OpenCode) has already said everything: reading stdin can
    // only hang them, because `execFile` leaves the pipe open and silent. See `readHookStdin`.
    let input: { cwd?: string; hook_event_name?: string } = {};
    if (!argOf("--cwd")) {
      try {
        input = JSON.parse((await readHookStdin()) || "{}");
      } catch {
        /* empty or half-written stdin: carry on with the defaults */
      }
    }
    const cwd = argOf("--cwd") || input.cwd || process.cwd();
    const link = useProjectServer(cwd);
    if (!link || link.ignore || !link.slug) return;

    // Through the authenticated API (it never touches the database): it respects permissions and exposes no inaccessible project.
    const res = await apiGet<{ project: string; text: string }>(
      `/context-pack?slug=${encodeURIComponent(link.slug)}&maxChars=${MAX_CTX}`,
    );
    if (!res || !res.text.trim()) return;

    // The header is the only place that tells the agent WHEN to write back, so its wording is
    // shared with the MCP's instructions and the skill (`capture-protocol.ts`), not written here.
    // The pointer to the skill only goes to whoever installs the plugin -- Claude and Codex, which
    // are the two that read this format. Hermes, OpenCode and Pi have no skill to be sent to.
    const header = sessionMemoryHeader(getBrandName(), res.project, { skill: format === "claude" });
    const additionalContext = `${header}\n\n${res.text.slice(0, MAX_CTX)}`; // the slice is a safety net: the server does the splitting

    if (format === "hermes") {
      process.stdout.write(JSON.stringify({ context: additionalContext })); // Hermes pre_llm_call
    } else if (format === "text") {
      process.stdout.write(additionalContext); // the OpenCode plugin reads stdout
    } else {
      process.stdout.write(JSON.stringify({ hookSpecificOutput: { hookEventName: input.hook_event_name || "SessionStart", additionalContext } })); // Claude / Codex
    }
  } catch {
    /* a hook must never break the session: stay silent */
  } finally {
    process.exit(0);
  }
}

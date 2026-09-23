import { firstPromptContext } from "../first-prompt.js";
import { readHookStdin } from "../hook-stdin.js";

/**
 * ADR-0074. By hand:
 * echo '{"session_id":"s1","cwd":"/path","prompt":"…"}' | cortex hook-lookup
 */
export async function run(): Promise<void> {
  try {
    let input: { session_id?: string; cwd?: string; transcript_path?: string; hook_event_name?: string } = {};
    try {
      input = JSON.parse((await readHookStdin()) || "{}");
    } catch {
      /* empty or half-written stdin: there is no session to tell apart, so nothing is said */
    }
    const additionalContext = firstPromptContext({
      sessionId: input.session_id,
      cwd: input.cwd || process.cwd(),
      codex: input.transcript_path?.includes("/.codex/") ?? false,
    });
    if (!additionalContext) return;
    // Only `additionalContext` reaches the model on this event: a `systemMessage` is painted in
    // the terminal and the agent never sees it.
    process.stdout.write(
      JSON.stringify({ hookSpecificOutput: { hookEventName: input.hook_event_name || "UserPromptSubmit", additionalContext } }),
    );
  } catch {
    /* a hook must never break the session, and this one blocks the user's message: stay silent */
  } finally {
    process.exit(0);
  }
}

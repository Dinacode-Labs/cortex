import { existsSync } from "node:fs";
import { basename } from "node:path";
import {
  condenseSession,
  latestCodexRollout,
  useProjectServer,
  readSessionByRef,
  sendCondensedSession,
  type CaptureAgent,
} from "@cortex/client";
import { readHookStdin } from "../hook-stdin.js";

/**
 * The AUTO-CAPTURE hook (end of session, and pre-compaction). It resolves the project through
 * the repo's `.cortex.json`, pulls the dialogue out of the session that just ended -- stripping
 * tool calls, dumps and secrets -- and sends it to the server, which is what distills it into
 * typed knowledge (ADR-0025). There is neither an LLM nor a database here: only the
 * `cortex auth login` session.
 *
 * Each agent reports the session its own way. Claude and Codex pass the transcript's path;
 * OpenCode and Hermes, an id; Pi, the path of its session file. Hence three ways of telling it
 * which one: `--session`, the JSON on stdin, or -- as a last resort, for Codex -- this repo's
 * most recent session.
 *
 * Silent by design: a hook runs inside an agent's session and must never break it. See
 * docs/research/hooks-integration.md.
 *
 *   cortex hook-capture [--platform claude|codex|opencode|hermes|pi] [--session <id|path>] [--cwd <dir>]
 */

const PLATFORMS: CaptureAgent[] = ["claude", "codex", "opencode", "hermes", "pi"];

function flag(args: string[], name: string): string | undefined {
  const i = args.indexOf(`--${name}`);
  if (i >= 0 && args[i + 1] && !args[i + 1]!.startsWith("--")) return args[i + 1];
  return args.find((a) => a.startsWith(`--${name}=`))?.split("=").slice(1).join("=");
}

/**
 * Where the agent comes from when nobody says: from the transcript's own path. Claude Code and
 * Codex share the plugin, so the hook cannot have it hardcoded.
 */
export function detectPlatform(transcript: string | undefined): CaptureAgent {
  if (transcript?.includes("/.codex/")) return "codex";
  if (transcript?.includes("/.pi/")) return "pi";
  return "claude";
}

export async function run(args: string[] = []): Promise<void> {
  try {
    // With `--session` stdin is not needed, and reading it can hang the hook: callers using
    // `execFile` (Pi, OpenCode) leave the pipe open and silent. See `readHookStdin`.
    let input: { cwd?: string; session_id?: string; sessionId?: string; transcript_path?: string } = {};
    if (!flag(args, "session")) {
      try {
        input = JSON.parse((await readHookStdin()) || "{}");
      } catch {
        input = {};
      }
    }

    const cwd = flag(args, "cwd") || input.cwd || process.cwd();
    const link = useProjectServer(cwd);
    if (!link || link.ignore || !link.slug) return;

    const asked = flag(args, "platform") as CaptureAgent | undefined;
    if (asked && !PLATFORMS.includes(asked)) return;
    const transcript = flag(args, "session") || input.transcript_path;
    const platform: CaptureAgent = asked ?? detectPlatform(transcript);
    const sessionId = input.session_id || input.sessionId;

    let condensed: string;
    let id: string;

    if (platform === "claude") {
      // Claude's transcript keeps more signal than the store, so it is read as is.
      if (!transcript || !existsSync(transcript)) return;
      condensed = condenseSession(transcript);
      id = sessionId || basename(transcript).replace(/\.jsonl$/, "");
    } else {
      // Codex sometimes gives neither a path nor an id (depending on the event): then, THIS
      // repo's most recent session. It is the one that just closed.
      const ref = transcript || sessionId || (platform === "codex" ? latestCodexRollout(cwd) : null);
      if (!ref) return;
      const session = await readSessionByRef(platform, ref);
      if (!session) return;
      condensed = session.condensed;
      id = session.sessionId;
    }

    if (!condensed.trim()) return;

    // It does not wait for the result: distilling takes a while and the hook has a short
    // timeout. The server queues the job and answers 202.
    const r = await sendCondensedSession({ slug: link.slug, condensed, sessionId: id, platform });
    if (r.status === "failed") {
      console.error(`[cortex hook] could not capture "${link.slug}": ${r.error ?? "error"} (check cortex auth login and the server)`);
    } else if (r.status !== "duplicate") {
      console.error(`[cortex hook] ${platform} session sent to "${link.slug}"; the server will distil it.`);
    }
  } catch {
    /* silent: a hook must not break the session */
  } finally {
    process.exit(0);
  }
}

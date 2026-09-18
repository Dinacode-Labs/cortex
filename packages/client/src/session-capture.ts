import { existsSync, readdirSync, statSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import type { CapturePlatform, CaptureSessionCounters, SourceType } from "@cortex/shared";
import { captureSession } from "./cortex-api.js";
import { condenseSession } from "./transcript-utils.js";
import { readSessions } from "./session-readers.js";

/** Agent platforms that have a session reader. */
export type CapturePlatformName = CapturePlatform;

/**
 * Sending agent sessions to the server so it can distill them (ADR-0025).
 *
 * The client does the cheap part -- reading the transcript and condensing it into useful
 * dialogue, with no tool calls and no dumps -- and the server does the expensive part. This
 * used to distill right here, which forced every laptop to keep an LLM key in the `.env` of
 * a cloned repo.
 *
 * It lives in `client` rather than in `agents` for exactly that reason: it no longer needs
 * the model.
 */

/**
 * Cap on what is sent per session. It matches the server's own
 * (`CORTEX_CAPTURE_SESSION_MAX_CHARS`), which answers 413 when exceeded.
 *
 * Trimming HERE rather than letting the server reject matters: a long working session with an
 * agent goes well past this size -- 154,000 characters in one measured case -- and those are
 * precisely the ones carrying the most knowledge. Rejecting one whole means losing the day.
 */
const MAX_CHARS = 150_000;

/**
 * Trims from the START, not from the end. A session ends in conclusions -- what was decided,
 * what was fixed, what is still open -- and begins in groping around. If something has to be
 * lost, let it be the groping. A marker is left behind so distillation does not read the cut
 * as the real beginning of the conversation.
 */
export function limitSession(condensed: string, max = MAX_CHARS): string {
  if (condensed.length <= max) return condensed;
  const notice = "[... the beginning of this session was omitted for size ...]\n\n";
  return notice + condensed.slice(condensed.length - (max - notice.length));
}

export interface SessionCaptureOutcome {
  sessionId: string;
  status: string;
  counters?: CaptureSessionCounters;
  error?: string;
}

/** Sends an already-condensed transcript. By default it does not wait for the result. */
export async function sendCondensedSession(opts: {
  slug: string;
  condensed: string;
  sessionId: string;
  platform: CapturePlatform;
  sourceType?: SourceType;
  wait?: boolean;
}): Promise<SessionCaptureOutcome> {
  const res = await captureSession(
    {
      slug: opts.slug,
      platform: opts.platform,
      sessionId: opts.sessionId,
      condensed: limitSession(opts.condensed),
      ...(opts.sourceType ? { sourceType: opts.sourceType } : {}),
    },
    { wait: opts.wait },
  );
  if (!res.ok) {
    const error = (res.data as { error?: string })?.error ?? `HTTP ${res.status}`;
    return { sessionId: opts.sessionId, status: "failed", error };
  }
  return { sessionId: opts.sessionId, status: res.data.status, counters: res.data.counters };
}

/** The hook's auto-capture: reads the `.jsonl` transcript, condenses it and sends it. */
export function sendSessionFile(
  slug: string,
  file: string,
  platform: CapturePlatform = "claude",
): Promise<SessionCaptureOutcome> {
  const sessionId = file.split("/").pop()!.replace(/\.jsonl$/, "");
  return sendCondensedSession({ slug, condensed: condenseSession(file), sessionId, platform });
}

/** A repo's Claude Code transcripts, newest first. */
export function readClaudeSessions(repoPath: string, limit?: number): { sessionId: string; condensed: string }[] {
  const folder = join(homedir(), ".claude/projects", repoPath.replace(/[^a-zA-Z0-9]/g, "-"));
  if (!existsSync(folder)) return [];
  let files = readdirSync(folder)
    .filter((f) => f.endsWith(".jsonl"))
    .map((f) => join(folder, f));
  files.sort((a, b) => statSync(b).mtimeMs - statSync(a).mtimeMs);
  if (limit) files = files.slice(0, limit);
  return files.map((f) => ({
    sessionId: f.split("/").pop()!.replace(/\.jsonl$/, ""),
    condensed: condenseSession(f),
  }));
}

/**
 * Retroactive backfill of a repo's sessions. It waits for each one (`wait`) because the user
 * is watching the counters; the hook, which runs silently, does not wait.
 */
export async function backfillSessions(
  slug: string,
  repoPath: string,
  platform: CapturePlatform,
  opts: { limit?: number; log?: (line: string) => void } = {},
): Promise<{ sessions: number; counters: CaptureSessionCounters }> {
  const log = opts.log ?? ((l: string) => console.log(l));
  const sessions =
    platform === "claude"
      ? readClaudeSessions(repoPath, opts.limit)
      : (await readSessions(platform, repoPath)).slice(0, opts.limit ?? Infinity);

  const total: CaptureSessionCounters = { saved: 0, updated: 0, superseded: 0, noop: 0, failed: 0, windows: 0 };
  if (sessions.length === 0) {
    log(`No ${platform} sessions for ${repoPath}.`);
    return { sessions: 0, counters: total };
  }
  log(`${sessions.length} ${platform} session(s) for ${repoPath}. The server will distill them → "${slug}"...`);

  for (const s of sessions) {
    const r = await sendCondensedSession({ ...s, slug, platform, wait: true });
    const c = r.counters;
    if (c) for (const k of Object.keys(total) as (keyof CaptureSessionCounters)[]) total[k] += c[k] ?? 0;
    const detail = c
      ? `+${c.saved} new, ~${c.updated} merged, ⊘${c.superseded} superseded${c.failed ? `, ${c.failed} failed` : ""}`
      : r.status === "duplicate"
        ? "already distilled"
        : (r.error ?? r.status);
    log(`  ${s.sessionId.slice(0, 8)}…: ${detail}`);
  }
  log(`Backfill: +${total.saved} new, ~${total.updated} UPDATE, ⊘${total.superseded} SUPERSEDE${total.failed ? `, ${total.failed} failed` : ""}.`);
  return { sessions: sessions.length, counters: total };
}

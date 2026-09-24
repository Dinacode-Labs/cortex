import { createHash } from "node:crypto";
import { getSql } from "@cortex/database";
import type { CaptureSessionCounters } from "@cortex/shared";
import type { Row } from "../storage/map.js";

/**
 * A record of which agent sessions have already been distilled.
 *
 * The end-of-session and pre-compaction hooks fire **several times over the same session**,
 * and distilling is the expensive part of the pipeline (one model call per transcript
 * window). Without this record, closing and reopening a session would pay twice for the same
 * knowledge.
 */

export type SessionCaptureStatus = "queued" | "running" | "done" | "failed";

export interface SessionCapture {
  id: string;
  status: SessionCaptureStatus;
  condensedHash: string;
  condensedChars: number;
  counters: Partial<CaptureSessionCounters>;
  error: string | null;
}

export function hashCondensed(condensed: string): string {
  return createHash("sha256").update(condensed).digest("hex");
}

const toCapture = (r: Row): SessionCapture => ({
  id: r.id as string,
  status: r.status as SessionCaptureStatus,
  condensedHash: r.condensed_hash as string,
  condensedChars: Number(r.condensed_chars ?? 0),
  counters: (r.counters ?? {}) as Partial<CaptureSessionCounters>,
  error: (r.error as string | null) ?? null,
});

export async function findSessionCapture(
  projectId: string,
  platform: string,
  sessionId: string,
): Promise<SessionCapture | null> {
  const rows = (await getSql()`
    SELECT id, status, condensed_hash, condensed_chars, counters, error
    FROM session_captures
    WHERE project_id = ${projectId} AND platform = ${platform} AND session_id = ${sessionId}
    LIMIT 1
  `) as unknown as Row[];
  return rows[0] ? toCapture(rows[0]) : null;
}

/**
 * Claims (or re-claims) the job of distilling a session and leaves it `queued`.
 *
 * A single `INSERT ... ON CONFLICT DO UPDATE` rather than check-then-write: two simultaneous
 * hooks over the same session is a real case, and with check-then-act both would believe they
 * were first.
 */
export async function upsertSessionCapture(input: {
  projectId: string;
  platform: string;
  sessionId: string;
  userEmail: string;
  hash: string;
  chars: number;
}): Promise<{ id: string }> {
  const rows = (await getSql()`
    INSERT INTO session_captures (project_id, platform, session_id, user_email, condensed_hash, condensed_chars, status, error)
    VALUES (${input.projectId}, ${input.platform}, ${input.sessionId}, ${input.userEmail}, ${input.hash}, ${input.chars}, 'queued', NULL)
    ON CONFLICT (project_id, platform, session_id) DO UPDATE
      SET condensed_hash = EXCLUDED.condensed_hash,
          condensed_chars = EXCLUDED.condensed_chars,
          user_email = EXCLUDED.user_email,
          status = 'queued',
          error = NULL,
          updated_at = now()
    RETURNING id
  `) as unknown as Row[];
  return { id: rows[0]!.id as string };
}

export async function markSessionCapture(
  id: string,
  status: SessionCaptureStatus,
  counters?: Partial<CaptureSessionCounters>,
  error?: string,
): Promise<void> {
  const sql = getSql();
  await sql`
    UPDATE session_captures
    SET status = ${status},
        counters = ${sql.json((counters ?? {}) as never)},
        error = ${error ?? null},
        updated_at = now()
    WHERE id = ${id}
  `;
}

export async function getSessionCaptureById(id: string): Promise<SessionCapture | null> {
  const rows = (await getSql()`
    SELECT id, status, condensed_hash, condensed_chars, counters, error
    FROM session_captures WHERE id = ${id} LIMIT 1
  `) as unknown as Row[];
  return rows[0] ? toCapture(rows[0]) : null;
}

/**
 * Marks as failed any job left `running` for more than `olderThanMinutes`.
 * A server restart mid-distillation leaves rows nobody is going to finish, and without this
 * they would block re-capturing that session forever.
 */
export async function reapStuckSessionCaptures(olderThanMinutes = 30): Promise<number> {
  const rows = (await getSql()`
    UPDATE session_captures
    SET status = 'failed', error = 'interrupted (the server restarted during distillation)', updated_at = now()
    WHERE status IN ('queued','running') AND updated_at < now() - (${olderThanMinutes} * interval '1 minute')
    RETURNING id
  `) as unknown as Row[];
  return rows.length;
}

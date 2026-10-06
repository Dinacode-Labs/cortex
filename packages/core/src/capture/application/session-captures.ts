import type { CaptureSessionCounters } from "@cortex/shared";
import { port } from "../../composition.js";
import type { NewSessionCapture, SessionCapture, SessionCaptureStatus } from "../domain/session-capture.js";

export { hashCondensed, type SessionCapture, type SessionCaptureStatus } from "../domain/session-capture.js";

export async function findSessionCapture(
  projectId: string,
  platform: string,
  sessionId: string,
): Promise<SessionCapture | null> {
  return port("sessionCaptures").find(projectId, platform, sessionId);
}

/**
 * Claims (or re-claims) the job of distilling a session and leaves it `queued`.
 *
 * A single `INSERT ... ON CONFLICT DO UPDATE` rather than check-then-write: two simultaneous
 * hooks over the same session is a real case, and with check-then-act both would believe they
 * were first.
 */
export async function upsertSessionCapture(input: NewSessionCapture): Promise<{ id: string }> {
  return port("sessionCaptures").claim(input);
}

export async function markSessionCapture(
  id: string,
  status: SessionCaptureStatus,
  counters?: Partial<CaptureSessionCounters>,
  error?: string,
): Promise<void> {
  await port("sessionCaptures").mark(id, status, counters ?? {}, error ?? null);
}

export async function getSessionCaptureById(id: string): Promise<SessionCapture | null> {
  return port("sessionCaptures").byId(id);
}

/**
 * Marks as failed any job left `running` for more than `olderThanMinutes`.
 * A server restart mid-distillation leaves rows nobody is going to finish, and without this
 * they would block re-capturing that session forever.
 */
export async function reapStuckSessionCaptures(olderThanMinutes = 30): Promise<number> {
  return port("sessionCaptures").failStuck(olderThanMinutes);
}

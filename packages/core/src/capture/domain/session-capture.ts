import { createHash } from "node:crypto";
import type { CaptureSessionCounters } from "@cortex/shared";

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

export interface NewSessionCapture {
  projectId: string;
  platform: string;
  sessionId: string;
  userEmail: string;
  hash: string;
  chars: number;
}

export interface SessionCaptureRepository {
  find(projectId: string, platform: string, sessionId: string): Promise<SessionCapture | null>;
  /** Atomic: two hooks firing over the same session at once is a real case, and check-then-write would let both win. */
  claim(input: NewSessionCapture): Promise<{ id: string }>;
  mark(
    id: string,
    status: SessionCaptureStatus,
    counters: Partial<CaptureSessionCounters>,
    error: string | null,
  ): Promise<void>;
  byId(id: string): Promise<SessionCapture | null>;
  failStuck(olderThanMinutes: number): Promise<number>;
}

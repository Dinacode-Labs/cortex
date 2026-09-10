import { createHash } from "node:crypto";
import { getSql } from "@cortex/database";
import type { CaptureSessionCounters } from "@cortex/shared";
import type { Row } from "./map.js";

/**
 * Registro de qué sesiones de agente se han destilado ya.
 *
 * Los hooks de fin de sesión y de pre-compactación disparan **varias veces sobre la misma
 * sesión**, y destilar es la parte cara del pipeline (una llamada al modelo por ventana de
 * transcript). Sin este registro, cerrar y reabrir una sesión pagaría dos veces por el
 * mismo conocimiento.
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
 * Reserva (o re-reserva) el trabajo de destilar una sesión y lo deja en `queued`.
 *
 * Un solo `INSERT … ON CONFLICT DO UPDATE` en vez de comprobar-y-luego-escribir: dos hooks
 * simultáneos sobre la misma sesión son un caso real, y con check-then-act los dos se
 * creerían los primeros.
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
 * Marca como fallidos los trabajos que quedaron `running` más de `olderThanMinutes`.
 * Un reinicio del servidor a media destilación deja filas que nadie va a terminar, y sin
 * esto bloquearían para siempre la re-captura de esa sesión.
 */
export async function reapStuckSessionCaptures(olderThanMinutes = 30): Promise<number> {
  const rows = (await getSql()`
    UPDATE session_captures
    SET status = 'failed', error = 'interrumpido (el servidor se reinició durante la destilación)', updated_at = now()
    WHERE status IN ('queued','running') AND updated_at < now() - (${olderThanMinutes} * interval '1 minute')
    RETURNING id
  `) as unknown as Row[];
  return rows.length;
}

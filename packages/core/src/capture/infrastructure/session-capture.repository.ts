import type { Sql } from "@cortex/database";
import type { CaptureSessionCounters } from "@cortex/shared";
import type { Row } from "../../infrastructure/rows.js";
import type {
  NewSessionCapture,
  SessionCapture,
  SessionCaptureRepository,
  SessionCaptureStatus,
} from "../domain/session-capture.js";

const toCapture = (r: Row): SessionCapture => ({
  id: r.id as string,
  status: r.status as SessionCaptureStatus,
  condensedHash: r.condensed_hash as string,
  condensedChars: Number(r.condensed_chars ?? 0),
  counters: (r.counters ?? {}) as Partial<CaptureSessionCounters>,
  error: (r.error as string | null) ?? null,
});

export class PgSessionCaptureRepository implements SessionCaptureRepository {
  constructor(private readonly sql: Sql) {}

  async find(projectId: string, platform: string, sessionId: string): Promise<SessionCapture | null> {
    const rows = (await this.sql`
      SELECT id, status, condensed_hash, condensed_chars, counters, error
      FROM session_captures
      WHERE project_id = ${projectId} AND platform = ${platform} AND session_id = ${sessionId}
      LIMIT 1
    `) as unknown as Row[];
    return rows[0] ? toCapture(rows[0]) : null;
  }

  async claim(input: NewSessionCapture): Promise<{ id: string }> {
    const rows = (await this.sql`
      INSERT INTO session_captures
        (project_id, platform, session_id, user_email, condensed_hash, condensed_chars, status, error)
      VALUES (${input.projectId}, ${input.platform}, ${input.sessionId}, ${input.userEmail},
              ${input.hash}, ${input.chars}, 'queued', NULL)
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

  async mark(
    id: string,
    status: SessionCaptureStatus,
    counters: Partial<CaptureSessionCounters>,
    error: string | null,
  ): Promise<void> {
    await this.sql`
      UPDATE session_captures
      SET status = ${status},
          counters = ${this.sql.json(counters as never)},
          error = ${error},
          updated_at = now()
      WHERE id = ${id}
    `;
  }

  async byId(id: string): Promise<SessionCapture | null> {
    const rows = (await this.sql`
      SELECT id, status, condensed_hash, condensed_chars, counters, error
      FROM session_captures WHERE id = ${id} LIMIT 1
    `) as unknown as Row[];
    return rows[0] ? toCapture(rows[0]) : null;
  }

  async failStuck(olderThanMinutes: number): Promise<number> {
    const rows = (await this.sql`
      UPDATE session_captures
      SET status = 'failed', error = 'interrupted (the server restarted during distillation)', updated_at = now()
      WHERE status IN ('queued','running') AND updated_at < now() - (${olderThanMinutes} * interval '1 minute')
      RETURNING id
    `) as unknown as Row[];
    return rows.length;
  }
}

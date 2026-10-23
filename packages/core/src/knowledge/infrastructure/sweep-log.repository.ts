import type { Row, Sql } from "@cortex/database";
import type { SweepLog } from "../domain/review-sweep.js";

export class PgSweepLog implements SweepLog {
  constructor(private readonly sql: Sql) {}

  async sweptUntil(projectId: string): Promise<Date | null> {
    const [row] = (await this.sql`SELECT swept_until FROM review_sweeps WHERE project_id = ${projectId}`) as unknown as Row[];
    return row ? new Date(row.swept_until as string) : null;
  }

  async record(projectId: string, until: Date): Promise<void> {
    await this.sql`
      INSERT INTO review_sweeps (project_id, swept_until) VALUES (${projectId}, ${until})
      ON CONFLICT (project_id) DO UPDATE SET swept_until = EXCLUDED.swept_until, swept_at = now()
    `;
  }
}

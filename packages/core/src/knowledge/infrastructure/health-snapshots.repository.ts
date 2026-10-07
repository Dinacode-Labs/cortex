import type { Row, Sql } from "@cortex/database";
import type { HealthSnapshot, HealthSnapshots } from "../domain/health.js";

export class PgHealthSnapshots implements HealthSnapshots {
  constructor(private readonly sql: Sql) {}

  async record(projectId: string, found: Omit<HealthSnapshot, "checkedAt">): Promise<void> {
    await this.sql`
      INSERT INTO project_health (project_id, contradictions, duplicates, checked_at)
      VALUES (${projectId}, ${found.contradictions}, ${found.duplicates}, now())
      ON CONFLICT (project_id) DO UPDATE
        SET contradictions = EXCLUDED.contradictions, duplicates = EXCLUDED.duplicates, checked_at = EXCLUDED.checked_at
    `;
  }

  async latest(projectIds: string[]): Promise<Map<string, HealthSnapshot>> {
    if (projectIds.length === 0) return new Map();
    const rows = (await this.sql`
      SELECT project_id, contradictions, duplicates, checked_at
      FROM project_health WHERE project_id = ANY(${projectIds})
    `) as unknown as Row[];
    return new Map(
      rows.map((r) => [
        r.project_id as string,
        { contradictions: Number(r.contradictions), duplicates: Number(r.duplicates), checkedAt: new Date(r.checked_at) },
      ]),
    );
  }
}

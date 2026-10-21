import type { Row, Sql } from "@cortex/database";
import type { DigestSubscriber, DigestSubscriptions, UnsubscribeTarget } from "../domain/digest-subscriptions.js";

export class PgDigestSubscriptions implements DigestSubscriptions {
  constructor(private readonly sql: Sql) {}

  async subscribers(): Promise<DigestSubscriber[]> {
    const rows = (await this.sql`
      SELECT u.email, d.last_sent_at, s.project_id, s.subscribed_at
        FROM review_digest_subscriptions s
        JOIN users u ON u.id = s.user_id
        LEFT JOIN review_digest_sends d ON d.user_id = s.user_id
       ORDER BY u.email, s.subscribed_at
    `) as unknown as Row[];
    const byEmail = new Map<string, DigestSubscriber>();
    for (const r of rows) {
      const email = r.email as string;
      const subscriber = byEmail.get(email) ?? { email, lastSentAt: r.last_sent_at ? new Date(r.last_sent_at as string) : null, projects: [] };
      subscriber.projects.push({ projectId: r.project_id as string, subscribedAt: new Date(r.subscribed_at as string) });
      byEmail.set(email, subscriber);
    }
    return [...byEmail.values()];
  }

  // Stored to the millisecond: `previous` comes back as a JS Date, which would never equal a
  // timestamp kept to the microsecond, and every claim would fail.
  async claim(email: string, previous: Date | null): Promise<boolean> {
    const rows = (await this.sql`
      INSERT INTO review_digest_sends (user_id, last_sent_at)
      SELECT id, date_trunc('milliseconds', now()) FROM users WHERE email = ${email}
      ON CONFLICT (user_id) DO UPDATE SET last_sent_at = EXCLUDED.last_sent_at
       WHERE review_digest_sends.last_sent_at IS NOT DISTINCT FROM ${previous}::timestamptz
      RETURNING user_id
    `) as unknown as Row[];
    return rows.length > 0;
  }

  async release(email: string, previous: Date | null): Promise<void> {
    const userId = this.sql`(SELECT id FROM users WHERE email = ${email})`;
    if (previous) await this.sql`UPDATE review_digest_sends SET last_sent_at = ${previous}::timestamptz WHERE user_id = ${userId}`;
    else await this.sql`DELETE FROM review_digest_sends WHERE user_id = ${userId}`;
  }

  async isSubscribed(email: string, projectId: string): Promise<boolean> {
    const rows = (await this.sql`
      SELECT 1
        FROM review_digest_subscriptions s
        JOIN users u ON u.id = s.user_id
       WHERE u.email = ${email} AND s.project_id = ${projectId}
    `) as unknown as Row[];
    return rows.length > 0;
  }

  async subscribe(email: string, projectId: string): Promise<void> {
    await this.sql`
      INSERT INTO review_digest_subscriptions (project_id, user_id)
      SELECT ${projectId}, id FROM users WHERE email = ${email}
      ON CONFLICT (project_id, user_id) DO NOTHING
    `;
  }

  async unsubscribe(email: string, projectId: string): Promise<void> {
    await this.sql`
      DELETE FROM review_digest_subscriptions
       WHERE project_id = ${projectId} AND user_id = (SELECT id FROM users WHERE email = ${email})
    `;
  }

  async issueUnsubscribeToken(target: UnsubscribeTarget, tokenHash: string, ttlDays: number): Promise<void> {
    await this.sql`DELETE FROM unsubscribe_tokens WHERE expires_at < now()`;
    await this.sql`
      INSERT INTO unsubscribe_tokens (token_hash, user_id, project_id, expires_at)
      SELECT ${tokenHash}, id, ${target.projectId}, now() + make_interval(days => ${ttlDays}::int) FROM users WHERE email = ${target.email}
    `;
  }

  async unsubscribeTarget(tokenHash: string): Promise<UnsubscribeTarget | null> {
    const [row] = (await this.sql`
      SELECT u.email, t.project_id
        FROM unsubscribe_tokens t
        JOIN users u ON u.id = t.user_id
       WHERE t.token_hash = ${tokenHash} AND t.expires_at > now()
    `) as unknown as Row[];
    return row ? { email: row.email as string, projectId: row.project_id as string } : null;
  }
}

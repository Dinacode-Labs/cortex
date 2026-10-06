import type { Sql } from "@cortex/database";
import type { Row } from "../../storage/map.js";
import type { Account, OtpVerdict, StoredOtp } from "../domain/auth.js";
import type { AuthRepository, IssuedToken } from "../domain/auth-repository.js";

const accountOf = (row: Row): Account => ({ id: row.id as string, user: { email: row.email as string } });

export class PgAuthRepository implements AuthRepository {
  constructor(private readonly sql: Sql) {}

  async countOtpsSince(email: string, windowMin: number): Promise<number> {
    const rows = (await this.sql`
      SELECT count(*)::int AS n FROM otp_codes
      WHERE email = ${email} AND created_at > now() - make_interval(mins => ${windowMin})
    `) as unknown as Row[];
    return Number(rows[0]?.n ?? 0);
  }

  async replaceOtp(email: string, codeHash: string, ttlMin: number): Promise<void> {
    await this.sql`UPDATE otp_codes SET consumed_at = now() WHERE email = ${email} AND consumed_at IS NULL`;
    await this.sql`
      INSERT INTO otp_codes (email, code_hash, expires_at)
      VALUES (${email}, ${codeHash}, now() + make_interval(mins => ${ttlMin}))
    `;
  }

  async verifyOtp(
    email: string,
    judge: (otp: StoredOtp | null) => OtpVerdict,
    token: IssuedToken,
  ): Promise<{ verdict: "valid"; account: Account } | { verdict: Exclude<OtpVerdict, "valid"> }> {
    return this.sql.begin(async (tx) => {
      const rows = (await tx`
        SELECT id, code_hash, attempts FROM otp_codes
        WHERE email = ${email} AND consumed_at IS NULL AND expires_at > now()
        ORDER BY created_at DESC LIMIT 1
        FOR UPDATE
      `) as unknown as Row[];
      const otp: StoredOtp | null = rows[0]
        ? { id: rows[0].id as string, codeHash: rows[0].code_hash as string, attempts: rows[0].attempts as number }
        : null;
      const verdict = judge(otp);
      if (verdict === "expired" || !otp) return { verdict: "expired" as const };
      if (verdict === "exhausted") {
        await tx`UPDATE otp_codes SET consumed_at = now() WHERE id = ${otp.id}`;
        return { verdict };
      }
      if (verdict === "wrong") {
        await tx`UPDATE otp_codes SET attempts = attempts + 1 WHERE id = ${otp.id}`;
        return { verdict };
      }
      await tx`UPDATE otp_codes SET consumed_at = now() WHERE id = ${otp.id}`;
      const users = (await tx`
        INSERT INTO users (email) VALUES (${email})
        ON CONFLICT (email) DO UPDATE SET last_login_at = now()
        RETURNING id, email
      `) as unknown as Row[];
      const account = accountOf(users[0]!);
      await tx`
        INSERT INTO auth_tokens (token_hash, user_id, expires_at)
        VALUES (${token.tokenHash}, ${account.id}, now() + make_interval(days => ${token.ttlDays}))
      `;
      return { verdict: "valid" as const, account };
    });
  }

  async accountByToken(tokenHash: string): Promise<Account | null> {
    const rows = (await this.sql`
      SELECT u.id, u.email FROM auth_tokens t JOIN users u ON u.id = t.user_id
      WHERE t.token_hash = ${tokenHash} AND t.expires_at > now() LIMIT 1
    `) as unknown as Row[];
    if (!rows[0]) return null;
    await this.sql`UPDATE auth_tokens SET last_used_at = now() WHERE token_hash = ${tokenHash}`;
    return accountOf(rows[0]);
  }

  async revokeToken(tokenHash: string): Promise<void> {
    await this.sql`DELETE FROM auth_tokens WHERE token_hash = ${tokenHash}`;
  }

  async createUiTicket(ticketHash: string, userId: string, ttlSec: number): Promise<void> {
    await this.sql`
      INSERT INTO ui_tickets (ticket_hash, user_id, expires_at)
      VALUES (${ticketHash}, ${userId}, now() + make_interval(secs => ${ttlSec}))
    `;
  }

  async redeemUiTicket(ticketHash: string, token: IssuedToken): Promise<Account | null> {
    const claim = (await this.sql`
      UPDATE ui_tickets SET used_at = now()
      WHERE ticket_hash = ${ticketHash} AND used_at IS NULL AND expires_at > now()
      RETURNING user_id
    `) as unknown as Row[];
    if (!claim[0]) return null;
    const userId = claim[0].user_id as string;
    const users = (await this.sql`SELECT id, email FROM users WHERE id = ${userId} LIMIT 1`) as unknown as Row[];
    if (!users[0]) return null;
    await this.sql`
      INSERT INTO auth_tokens (token_hash, user_id, expires_at)
      VALUES (${token.tokenHash}, ${userId}, now() + make_interval(days => ${token.ttlDays}))
    `;
    return accountOf(users[0]);
  }
}

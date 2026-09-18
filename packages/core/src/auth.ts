import { createHash, randomBytes, randomInt } from "node:crypto";
import { getSql } from "@cortex/database";
import { getEnvNum } from "@cortex/shared";
import { sendOtpEmail } from "./email.js";
import type { Row } from "./map.js";

/**
 * Email + OTP authentication (no passwords). `requestOtp` generates a code and sends it;
 * `verifyOtp` validates it and issues a session token (Bearer); `validateToken` resolves the
 * user behind a token. Codes and tokens are stored HASHED. A user IS their email address.
 */
const MAX_ATTEMPTS = 5;

const sha = (s: string): string => createHash("sha256").update(s).digest("hex");
const normEmail = (e: string): string => e.trim().toLowerCase();
const csv = (v: string | undefined): string[] => (v ?? "").split(",").map((s) => s.trim().toLowerCase()).filter(Boolean);

// Config read LAZILY (not on module load): robust against the order of loadEnv/imports.
const otpTtlMin = (): number => getEnvNum("CORTEX_OTP_TTL_MIN", 10);
const tokenTtlDays = (): number => getEnvNum("CORTEX_TOKEN_TTL_DAYS", 30);
const otpRateMax = (): number => getEnvNum("CORTEX_OTP_RATE_MAX", 5);
const otpRateWindowMin = (): number => getEnvNum("CORTEX_OTP_RATE_WINDOW_MIN", 15);
/** Allowed domains (comma-separated whitelist). Empty = anyone. There is no sign-up step: the first valid login creates the user. */
// No default: the allowed domain depends on whoever deploys. Empty = anyone can register
// (the server warns on startup); inheriting somebody else's domain would be worse.
const authDomains = (): string[] => csv(process.env.CORTEX_AUTH_DOMAIN ?? "");
/** Admin emails (comma-separated; there can be several). They manage permissions and see every project. */
const adminEmails = (): string[] => csv(process.env.CORTEX_ADMIN_EMAIL);

export function isAllowedEmail(emailRaw: string): boolean {
  const email = normEmail(emailRaw);
  const domains = authDomains();
  return domains.length === 0 || domains.some((d) => email.endsWith(`@${d}`));
}

/** Is this an admin? (configured through CORTEX_ADMIN_EMAIL, one or several). */
export function isAdmin(email: string | null | undefined): boolean {
  return !!email && adminEmails().includes(normEmail(email));
}

/** The configured admins (for "ask X for access"). */
export function listAdmins(): string[] {
  return adminEmails();
}

export interface AuthUser {
  id: string;
  email: string;
  admin: boolean;
}

/** Generates an OTP for the email and sends it (Brevo or dev-log). Invalidates earlier ones. */
export async function requestOtp(emailRaw: string): Promise<void> {
  const email = normEmail(emailRaw);
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) throw new Error("That does not look like an email address.");
  if (!isAllowedEmail(email)) throw new Error(`That email domain is not allowed here (only: ${authDomains().join(", ") || "—"}).`);
  const sql = getSql();
  const recent = (await sql`
    SELECT count(*)::int AS n FROM otp_codes
    WHERE email = ${email} AND created_at > now() - make_interval(mins => ${otpRateWindowMin()})
  `) as unknown as Row[];
  if ((recent[0]?.n as number) >= otpRateMax()) {
    throw new Error("Too many codes requested. Wait a few minutes and try again.");
  }
  const code = String(randomInt(0, 1_000_000)).padStart(6, "0");
  await sql`UPDATE otp_codes SET consumed_at = now() WHERE email = ${email} AND consumed_at IS NULL`;
  await sql`
    INSERT INTO otp_codes (email, code_hash, expires_at)
    VALUES (${email}, ${sha(code)}, now() + make_interval(mins => ${otpTtlMin()}))
  `;
  await sendOtpEmail(email, code);
}

/** Verifies the OTP and, when correct, creates/updates the user and returns a token. */
export async function verifyOtp(emailRaw: string, codeRaw: string): Promise<{ token: string; user: AuthUser }> {
  const email = normEmail(emailRaw);
  const code = codeRaw.trim();
  const sql = getSql();
  const result = await sql.begin(async (tx) => {
    const rows = (await tx`
      SELECT * FROM otp_codes
      WHERE email = ${email} AND consumed_at IS NULL AND expires_at > now()
      ORDER BY created_at DESC LIMIT 1
      FOR UPDATE
    `) as unknown as Row[];
    const otp = rows[0];
    if (!otp) return { ok: false as const, error: "That code has expired or never existed. Ask for a new one." };
    if ((otp.attempts as number) >= MAX_ATTEMPTS) {
      await tx`UPDATE otp_codes SET consumed_at = now() WHERE id = ${otp.id}`;
      return { ok: false as const, error: "Too many attempts. Ask for a new code." };
    }
    if (sha(code) !== otp.code_hash) {
      await tx`UPDATE otp_codes SET attempts = attempts + 1 WHERE id = ${otp.id}`;
      return { ok: false as const, error: "Wrong code." };
    }
    await tx`UPDATE otp_codes SET consumed_at = now() WHERE id = ${otp.id}`;

    const urows = (await tx`
      INSERT INTO users (email) VALUES (${email})
      ON CONFLICT (email) DO UPDATE SET last_login_at = now()
      RETURNING id, email
    `) as unknown as Row[];
    const user: AuthUser = { id: urows[0]!.id as string, email: urows[0]!.email as string, admin: isAdmin(urows[0]!.email as string) };

    const token = randomBytes(32).toString("base64url");
    await tx`
      INSERT INTO auth_tokens (token_hash, user_id, expires_at)
      VALUES (${sha(token)}, ${user.id}, now() + make_interval(days => ${tokenTtlDays()}))
    `;
    return { ok: true as const, token, user };
  });
  if (!result.ok) throw new Error(result.error);
  return { token: result.token, user: result.user };
}

/** Resolves the user behind a token (or null). Updates last_used_at. */
export async function validateToken(token: string): Promise<AuthUser | null> {
  if (!token) return null;
  const sql = getSql();
  const rows = (await sql`
    SELECT u.id, u.email FROM auth_tokens t JOIN users u ON u.id = t.user_id
    WHERE t.token_hash = ${sha(token)} AND t.expires_at > now() LIMIT 1
  `) as unknown as Row[];
  if (!rows[0]) return null;
  await sql`UPDATE auth_tokens SET last_used_at = now() WHERE token_hash = ${sha(token)}`;
  return { id: rows[0].id as string, email: rows[0].email as string, admin: isAdmin(rows[0].email as string) };
}

/** Revokes a token (logout). */
export async function revokeToken(token: string): Promise<void> {
  await getSql()`DELETE FROM auth_tokens WHERE token_hash = ${sha(token)}`;
}

const TICKET_TTL_SEC = getEnvNum("CORTEX_UI_TICKET_TTL_SEC", 90);

/** Issues a short, single-use ticket for the `cortex ui` handshake. It needs a valid CLI
 * token. The ticket is NOT the token: the web exchanges it for a session of its own. */
export async function createUiTicket(cliToken: string): Promise<string | null> {
  const user = await validateToken(cliToken);
  if (!user) return null;
  const ticket = randomBytes(24).toString("base64url");
  await getSql()`
    INSERT INTO ui_tickets (ticket_hash, user_id, expires_at)
    VALUES (${sha(ticket)}, ${user.id}, now() + make_interval(secs => ${TICKET_TTL_SEC}))
  `;
  return ticket;
}

/** Exchanges a ticket (atomic -> single use) for a NEW web session. null when invalid. */
export async function redeemUiTicket(ticket: string): Promise<{ token: string; user: AuthUser } | null> {
  if (!ticket) return null;
  const sql = getSql();
  const claim = (await sql`
    UPDATE ui_tickets SET used_at = now()
    WHERE ticket_hash = ${sha(ticket)} AND used_at IS NULL AND expires_at > now()
    RETURNING user_id
  `) as unknown as Row[];
  if (!claim[0]) return null;
  const userId = claim[0].user_id as string;
  const urows = (await sql`SELECT email FROM users WHERE id = ${userId} LIMIT 1`) as unknown as Row[];
  if (!urows[0]) return null;
  const email = urows[0].email as string;
  const token = randomBytes(32).toString("base64url"); // a fresh web session (not the CLI token)
  await sql`
    INSERT INTO auth_tokens (token_hash, user_id, expires_at)
    VALUES (${sha(token)}, ${userId}, now() + make_interval(days => ${tokenTtlDays()}))
  `;
  return { token, user: { id: userId, email, admin: isAdmin(email) } };
}

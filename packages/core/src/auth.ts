import { createHash, randomBytes, randomInt } from "node:crypto";
import { getSql } from "@cortex/database";
import { sendOtpEmail } from "./email.js";
import type { Row } from "./map.js";

/**
 * Autenticación email + OTP (sin passwords). `requestOtp` genera un código y lo envía;
 * `verifyOtp` lo valida y emite un token de sesión (Bearer); `validateToken` resuelve el
 * usuario de un token. Códigos y tokens se guardan HASHEADOS. El usuario ES su correo.
 */
const OTP_TTL_MIN = Number(process.env.CORTEX_OTP_TTL_MIN ?? "10");
const TOKEN_TTL_DAYS = Number(process.env.CORTEX_TOKEN_TTL_DAYS ?? "30");
const AUTH_DOMAIN = process.env.CORTEX_AUTH_DOMAIN ?? "dinacode.com"; // "" = cualquiera
const MAX_ATTEMPTS = 5;

const sha = (s: string): string => createHash("sha256").update(s).digest("hex");
const normEmail = (e: string): string => e.trim().toLowerCase();

export interface AuthUser {
  id: string;
  email: string;
}

/** Genera un OTP para el email y lo envía (Brevo o dev-log). Invalida los previos. */
export async function requestOtp(emailRaw: string): Promise<void> {
  const email = normEmail(emailRaw);
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) throw new Error("Email inválido.");
  if (AUTH_DOMAIN && !email.endsWith(`@${AUTH_DOMAIN}`)) throw new Error(`Solo se permiten correos @${AUTH_DOMAIN}.`);
  const code = String(randomInt(0, 1_000_000)).padStart(6, "0");
  const sql = getSql();
  await sql`UPDATE otp_codes SET consumed_at = now() WHERE email = ${email} AND consumed_at IS NULL`;
  await sql`
    INSERT INTO otp_codes (email, code_hash, expires_at)
    VALUES (${email}, ${sha(code)}, now() + make_interval(mins => ${OTP_TTL_MIN}))
  `;
  await sendOtpEmail(email, code);
}

/** Verifica el OTP y, si es correcto, crea/actualiza el usuario y devuelve un token. */
export async function verifyOtp(emailRaw: string, codeRaw: string): Promise<{ token: string; user: AuthUser }> {
  const email = normEmail(emailRaw);
  const code = codeRaw.trim();
  const sql = getSql();
  const rows = (await sql`
    SELECT * FROM otp_codes
    WHERE email = ${email} AND consumed_at IS NULL AND expires_at > now()
    ORDER BY created_at DESC LIMIT 1
  `) as unknown as Row[];
  const otp = rows[0];
  if (!otp) throw new Error("Código expirado o inexistente. Pide uno nuevo.");
  if ((otp.attempts as number) >= MAX_ATTEMPTS) {
    await sql`UPDATE otp_codes SET consumed_at = now() WHERE id = ${otp.id}`;
    throw new Error("Demasiados intentos. Pide un código nuevo.");
  }
  if (sha(code) !== otp.code_hash) {
    await sql`UPDATE otp_codes SET attempts = attempts + 1 WHERE id = ${otp.id}`;
    throw new Error("Código incorrecto.");
  }
  await sql`UPDATE otp_codes SET consumed_at = now() WHERE id = ${otp.id}`;

  const urows = (await sql`
    INSERT INTO users (email) VALUES (${email})
    ON CONFLICT (email) DO UPDATE SET last_login_at = now()
    RETURNING id, email
  `) as unknown as Row[];
  const user: AuthUser = { id: urows[0]!.id as string, email: urows[0]!.email as string };

  const token = randomBytes(32).toString("base64url");
  await sql`
    INSERT INTO auth_tokens (token_hash, user_id, expires_at)
    VALUES (${sha(token)}, ${user.id}, now() + make_interval(days => ${TOKEN_TTL_DAYS}))
  `;
  return { token, user };
}

/** Resuelve el usuario de un token (o null). Actualiza last_used_at. */
export async function validateToken(token: string): Promise<AuthUser | null> {
  if (!token) return null;
  const sql = getSql();
  const rows = (await sql`
    SELECT u.id, u.email FROM auth_tokens t JOIN users u ON u.id = t.user_id
    WHERE t.token_hash = ${sha(token)} AND t.expires_at > now() LIMIT 1
  `) as unknown as Row[];
  if (!rows[0]) return null;
  await sql`UPDATE auth_tokens SET last_used_at = now() WHERE token_hash = ${sha(token)}`;
  return { id: rows[0].id as string, email: rows[0].email as string };
}

/** Revoca un token (logout). */
export async function revokeToken(token: string): Promise<void> {
  await getSql()`DELETE FROM auth_tokens WHERE token_hash = ${sha(token)}`;
}

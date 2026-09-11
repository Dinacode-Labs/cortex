import { createHash, randomBytes, randomInt } from "node:crypto";
import { getSql } from "@cortex/database";
import { getEnvNum } from "@cortex/shared";
import { sendOtpEmail } from "./email.js";
import type { Row } from "./map.js";

/**
 * Autenticación email + OTP (sin passwords). `requestOtp` genera un código y lo envía;
 * `verifyOtp` lo valida y emite un token de sesión (Bearer); `validateToken` resuelve el
 * usuario de un token. Códigos y tokens se guardan HASHEADOS. El usuario ES su correo.
 */
const MAX_ATTEMPTS = 5;

const sha = (s: string): string => createHash("sha256").update(s).digest("hex");
const normEmail = (e: string): string => e.trim().toLowerCase();
const csv = (v: string | undefined): string[] => (v ?? "").split(",").map((s) => s.trim().toLowerCase()).filter(Boolean);

// Config leída LAZY (no al cargar el módulo): robusta ante el orden de loadEnv/imports.
const otpTtlMin = (): number => getEnvNum("CORTEX_OTP_TTL_MIN", 10);
const tokenTtlDays = (): number => getEnvNum("CORTEX_TOKEN_TTL_DAYS", 30);
const otpRateMax = (): number => getEnvNum("CORTEX_OTP_RATE_MAX", 5);
const otpRateWindowMin = (): number => getEnvNum("CORTEX_OTP_RATE_WINDOW_MIN", 15);
/** Dominios permitidos (whitelist, coma-separado). Vacío = cualquiera. Sin registro: el primer login válido crea el usuario. */
// Sin default: el dominio permitido depende de quién despliegue. Vacío = cualquiera puede
// registrarse (el servidor avisa al arrancar); heredar un dominio ajeno sería peor.
const authDomains = (): string[] => csv(process.env.CORTEX_AUTH_DOMAIN ?? "");
/** Emails admin (coma-separado; puede haber varios). Gestionan permisos y ven todos los proyectos. */
const adminEmails = (): string[] => csv(process.env.CORTEX_ADMIN_EMAIL);

export function isAllowedEmail(emailRaw: string): boolean {
  const email = normEmail(emailRaw);
  const domains = authDomains();
  return domains.length === 0 || domains.some((d) => email.endsWith(`@${d}`));
}

/** ¿Es admin? (config por env CORTEX_ADMIN_EMAIL, uno o varios). */
export function isAdmin(email: string | null | undefined): boolean {
  return !!email && adminEmails().includes(normEmail(email));
}

/** Lista de admins configurados (para "pide acceso a…"). */
export function listAdmins(): string[] {
  return adminEmails();
}

export interface AuthUser {
  id: string;
  email: string;
  admin: boolean;
}

/** Genera un OTP para el email y lo envía (Brevo o dev-log). Invalida los previos. */
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

/** Verifica el OTP y, si es correcto, crea/actualiza el usuario y devuelve un token. */
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
    if (!otp) return { ok: false as const, error: "Código expirado o inexistente. Pide uno nuevo." };
    if ((otp.attempts as number) >= MAX_ATTEMPTS) {
      await tx`UPDATE otp_codes SET consumed_at = now() WHERE id = ${otp.id}`;
      return { ok: false as const, error: "Demasiados intentos. Pide un código nuevo." };
    }
    if (sha(code) !== otp.code_hash) {
      await tx`UPDATE otp_codes SET attempts = attempts + 1 WHERE id = ${otp.id}`;
      return { ok: false as const, error: "Código incorrecto." };
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
  return { id: rows[0].id as string, email: rows[0].email as string, admin: isAdmin(rows[0].email as string) };
}

/** Revoca un token (logout). */
export async function revokeToken(token: string): Promise<void> {
  await getSql()`DELETE FROM auth_tokens WHERE token_hash = ${sha(token)}`;
}

const TICKET_TTL_SEC = getEnvNum("CORTEX_UI_TICKET_TTL_SEC", 90);

/** Emite un ticket de un solo uso (corto) para el handshake `cortex ui`. Requiere un
 * token de CLI válido. El ticket NO es el token: la web lo canjea por una sesión propia. */
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

/** Canjea un ticket (atómico → un solo uso) por una NUEVA sesión web. null si inválido. */
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
  const token = randomBytes(32).toString("base64url"); // sesión web nueva (≠ token CLI)
  await sql`
    INSERT INTO auth_tokens (token_hash, user_id, expires_at)
    VALUES (${sha(token)}, ${userId}, now() + make_interval(days => ${tokenTtlDays()}))
  `;
  return { token, user: { id: userId, email, admin: isAdmin(email) } };
}

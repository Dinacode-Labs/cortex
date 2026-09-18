import { createTransport, type Transporter } from "nodemailer";
import { getEnv, getEnvNum } from "@cortex/shared";

/**
 * Generic SMTP transport. It lives in its own module so `email.ts` can import it lazily:
 * whoever uses `log` or `brevo` never loads nodemailer.
 *
 * Env: SMTP_HOST (required), SMTP_PORT (default 587), SMTP_USER, SMTP_PASS,
 *      SMTP_SECURE (1/true -> implicit TLS, the usual thing on port 465).
 */

let transport: Transporter | undefined;

export function createSmtpTransport(): Transporter {
  if (transport) return transport;
  const host = getEnv("SMTP_HOST", "").trim();
  if (!host) throw new Error("SMTP_HOST is required with CORTEX_EMAIL_PROVIDER=smtp.");
  const port = getEnvNum("SMTP_PORT", 587);
  const secureRaw = getEnv("SMTP_SECURE", "").trim().toLowerCase();
  const user = getEnv("SMTP_USER", "").trim();
  const pass = getEnv("SMTP_PASS", "").trim();
  transport = createTransport({
    host,
    port,
    // `secure` = TLS from the start (465). Port 587 uses STARTTLS, which nodemailer
    // negotiates on its own with secure:false.
    secure: secureRaw === "1" || secureRaw === "true" || port === 465,
    ...(user ? { auth: { user, pass } } : {}), // an internal relay with no auth is allowed
  });
  return transport;
}

/** Drops the cached transport. Tests only. */
export function resetSmtpTransport(): void {
  transport = undefined;
}

import { createTransport, type Transporter } from "nodemailer";
import { getEnv, getEnvNum } from "@cortex/shared";

/**
 * Transporte SMTP genérico. Vive en un módulo aparte para que `email.ts` pueda importarlo
 * de forma perezosa: quien usa `log` o `brevo` no carga nodemailer.
 *
 * Env: SMTP_HOST (obligatorio), SMTP_PORT (def. 587), SMTP_USER, SMTP_PASS,
 *      SMTP_SECURE (1/true → TLS implícito, lo habitual en el puerto 465).
 */

let transport: Transporter | undefined;

export function createSmtpTransport(): Transporter {
  if (transport) return transport;
  const host = getEnv("SMTP_HOST", "").trim();
  if (!host) throw new Error("SMTP_HOST es obligatorio con CORTEX_EMAIL_PROVIDER=smtp.");
  const port = getEnvNum("SMTP_PORT", 587);
  const secureRaw = getEnv("SMTP_SECURE", "").trim().toLowerCase();
  const user = getEnv("SMTP_USER", "").trim();
  const pass = getEnv("SMTP_PASS", "").trim();
  transport = createTransport({
    host,
    port,
    // `secure` = TLS desde el principio (465). En 587 se usa STARTTLS, que nodemailer
    // negocia solo con secure:false.
    secure: secureRaw === "1" || secureRaw === "true" || port === 465,
    ...(user ? { auth: { user, pass } } : {}), // relay interno sin auth: se admite
  });
  return transport;
}

/** Descarta el transporte cacheado. Solo para tests. */
export function resetSmtpTransport(): void {
  transport = undefined;
}

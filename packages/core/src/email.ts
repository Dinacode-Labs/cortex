import { getBrandName, getEnv } from "@cortex/shared";

/**
 * Transactional email (today only the login OTP) with a **pluggable** provider:
 *
 *   CORTEX_EMAIL_PROVIDER=log    -> prints the code to the console, sends nothing (dev default)
 *                        =brevo  -> the Brevo API (BREVO_API_KEY)
 *                        =smtp   -> generic SMTP through nodemailer (SMTP_HOST/PORT/USER/PASS)
 *
 * The selection lives here rather than in the entrypoints (unlike the classifier or the
 * reranker, which are injected) because the only consumer is `requestOtp`, in this very
 * package, and the choice is pure configuration: threading it through all four entrypoints
 * would be ritual with no gain. `setEmailSender` covers tests and overrides. See ADR-0028.
 */

export interface EmailMessage {
  to: string;
  subject: string;
  html: string;
  text: string;
}

export interface EmailSender {
  readonly name: string;
  send(msg: EmailMessage): Promise<void>;
}

const BREVO_ENDPOINT = "https://api.brevo.com/v3/smtp/email";
const SEND_TIMEOUT_MS = 10_000;

let override: EmailSender | undefined;
let cached: EmailSender | undefined;

/** Injects an explicit sender (tests, or an entrypoint with needs of its own).
 *  `undefined` goes back to environment-driven selection. */
export function setEmailSender(sender: EmailSender | undefined): void {
  override = sender;
  cached = undefined;
}

/** Sender address and name. No default: it depends on the deployer's own domain. */
function fromAddress(): { email: string; name: string } {
  // BREVO_SENDER/BREVO_SENDER_NAME are the old names; they are accepted as aliases.
  const email = (getEnv("CORTEX_EMAIL_FROM", "").trim() || getEnv("BREVO_SENDER", "").trim());
  if (!email) {
    throw new Error("CORTEX_EMAIL_FROM is required with the brevo/smtp providers (the sender address).");
  }
  const name = getEnv("CORTEX_EMAIL_FROM_NAME", "").trim() || getEnv("BREVO_SENDER_NAME", "").trim() || getBrandName();
  return { email, name };
}

function logSender(): EmailSender {
  return {
    name: "log",
    async send(msg) {
      // CONTRACT: the integration tests capture the 6-digit code from this very line.
      console.log(`[email:log] (${msg.subject}) to ${msg.to}: ${msg.text}`);
    },
  };
}

function brevoSender(): EmailSender {
  return {
    name: "brevo",
    async send(msg) {
      const key = getEnv("BREVO_API_KEY", "").trim();
      if (!key) throw new Error("BREVO_API_KEY is required with CORTEX_EMAIL_PROVIDER=brevo.");
      const from = fromAddress();
      const res = await fetch(BREVO_ENDPOINT, {
        method: "POST",
        headers: { "api-key": key, "content-type": "application/json", accept: "application/json" },
        body: JSON.stringify({
          sender: { email: from.email, name: from.name },
          to: [{ email: msg.to }],
          subject: msg.subject,
          htmlContent: msg.html,
        }),
        signal: AbortSignal.timeout(SEND_TIMEOUT_MS),
      });
      if (!res.ok) throw new Error(`Brevo ${res.status}: ${(await res.text()).slice(0, 200)}`);
    },
  };
}

function smtpSender(): EmailSender {
  return {
    name: "smtp",
    async send(msg) {
      // Lazy import: nodemailer is only loaded when SMTP is really used, so it costs nothing
      // at startup for anyone running `log` or `brevo`.
      const { createSmtpTransport } = await import("./email-smtp.js");
      const transport = createSmtpTransport();
      const from = fromAddress();
      await transport.sendMail({
        from: { address: from.email, name: from.name },
        to: msg.to,
        subject: msg.subject,
        text: msg.text,
        html: msg.html,
      });
    },
  };
}

/** The active sender: explicit override > `CORTEX_EMAIL_PROVIDER` > backwards compatibility. */
export function getEmailSender(): EmailSender {
  if (override) return override;
  if (cached) return cached;
  // With no variable set: if there is a Brevo key, assume brevo (the behaviour before
  // ADR-0028); otherwise `log`, so the auth flow can be tried with nothing configured.
  const provider =
    getEnv("CORTEX_EMAIL_PROVIDER", "").trim().toLowerCase() ||
    (getEnv("BREVO_API_KEY", "").trim() ? "brevo" : "log");
  switch (provider) {
    case "log":
      cached = logSender();
      break;
    case "brevo":
      cached = brevoSender();
      break;
    case "smtp":
      cached = smtpSender();
      break;
    default:
      throw new Error(`Unknown CORTEX_EMAIL_PROVIDER: "${provider}". Use log | brevo | smtp.`);
  }
  return cached;
}

/**
 * Checks the email configuration at startup and returns non-fatal warnings. It throws when
 * the chosen provider cannot work: better not to start than to find out when a user is
 * locked out.
 */
export function validateEmailConfig(): string[] {
  const warnings: string[] = [];
  const sender = getEmailSender();
  if (sender.name === "log") {
    if (process.env.NODE_ENV === "production") {
      warnings.push(
        "[email] CORTEX_EMAIL_PROVIDER=log in production: OTP codes are printed to the log and NOT emailed.",
      );
    }
    return warnings;
  }
  fromAddress(); // throws when the sender is missing
  if (sender.name === "brevo" && !getEnv("BREVO_API_KEY", "").trim()) {
    throw new Error("BREVO_API_KEY is required with CORTEX_EMAIL_PROVIDER=brevo.");
  }
  if (sender.name === "smtp" && !getEnv("SMTP_HOST", "").trim()) {
    throw new Error("SMTP_HOST is required with CORTEX_EMAIL_PROVIDER=smtp.");
  }
  return warnings;
}

/** Sends the single-use sign-in code. */
export async function sendOtpEmail(email: string, code: string): Promise<void> {
  const brand = getBrandName();
  await getEmailSender().send({
    to: email,
    subject: `Your ${brand} sign-in code`,
    // The literal "OTP code for <email>: <code>" is the contract the auth integration tests
    // capture from the `log` sender; do not change it without changing them.
    text: `OTP code for ${email}: ${code}`,
    html:
      `<p>Hi,</p><p>Your sign-in code for <b>${brand}</b> is:</p>` +
      `<p style="font-size:28px;font-weight:700;letter-spacing:4px">${code}</p>` +
      `<p>It expires in a few minutes. If you did not ask for it, ignore this email.</p>`,
  });
}

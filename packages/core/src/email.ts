import { getBrandName, getEnv } from "@cortex/shared";

/**
 * Email transaccional (hoy solo el OTP de login) con proveedor **enchufable**:
 *
 *   CORTEX_EMAIL_PROVIDER=log    -> imprime el código por consola, no envía (default en dev)
 *                        =brevo  -> API de Brevo (BREVO_API_KEY)
 *                        =smtp   -> SMTP genérico vía nodemailer (SMTP_HOST/PORT/USER/PASS)
 *
 * La selección vive aquí y no en los entrypoints (a diferencia del classifier o el
 * reranker, que sí se inyectan) porque el único consumidor es `requestOtp`, en este mismo
 * paquete, y la elección es configuración pura: pasarla por los cuatro entrypoints sería
 * ritual sin ganancia. `setEmailSender` cubre el caso de tests y overrides. Ver ADR-0028.
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

/** Inyecta un sender explícito (tests, o un entrypoint con necesidades propias).
 *  `undefined` vuelve a la selección por entorno. */
export function setEmailSender(sender: EmailSender | undefined): void {
  override = sender;
  cached = undefined;
}

/** Dirección y nombre del remitente. Sin default: depende del dominio de quien despliega. */
function fromAddress(): { email: string; name: string } {
  // BREVO_SENDER/BREVO_SENDER_NAME son los nombres antiguos; se aceptan como alias.
  const email = (getEnv("CORTEX_EMAIL_FROM", "").trim() || getEnv("BREVO_SENDER", "").trim());
  if (!email) {
    throw new Error("CORTEX_EMAIL_FROM es obligatorio con los proveedores brevo/smtp (dirección remitente).");
  }
  const name = getEnv("CORTEX_EMAIL_FROM_NAME", "").trim() || getEnv("BREVO_SENDER_NAME", "").trim() || getBrandName();
  return { email, name };
}

function logSender(): EmailSender {
  return {
    name: "log",
    async send(msg) {
      // CONTRATO: los tests de integración capturan el código de 6 dígitos de esta línea.
      console.log(`[email:log] (${msg.subject}) para ${msg.to}: ${msg.text}`);
    },
  };
}

function brevoSender(): EmailSender {
  return {
    name: "brevo",
    async send(msg) {
      const key = getEnv("BREVO_API_KEY", "").trim();
      if (!key) throw new Error("BREVO_API_KEY es obligatoria con CORTEX_EMAIL_PROVIDER=brevo.");
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
      // Import perezoso: nodemailer solo se carga si de verdad se usa SMTP, así que no
      // pesa en el arranque de quien va con `log` o `brevo`.
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

/** Sender activo: override explícito > `CORTEX_EMAIL_PROVIDER` > compatibilidad. */
export function getEmailSender(): EmailSender {
  if (override) return override;
  if (cached) return cached;
  // Sin variable: si hay clave de Brevo se asume brevo (comportamiento previo a ADR-0028);
  // si no, `log`, para que el flujo de auth se pueda probar sin configurar nada.
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
      throw new Error(`CORTEX_EMAIL_PROVIDER desconocido: "${provider}". Usa log | brevo | smtp.`);
  }
  return cached;
}

/**
 * Comprueba la config de email al arrancar y devuelve avisos no fatales. Lanza si el
 * proveedor elegido no puede funcionar: es mejor no arrancar que descubrirlo cuando un
 * usuario se quede sin poder entrar.
 */
export function validateEmailConfig(): string[] {
  const warnings: string[] = [];
  const sender = getEmailSender();
  if (sender.name === "log") {
    if (process.env.NODE_ENV === "production") {
      warnings.push(
        "[email] CORTEX_EMAIL_PROVIDER=log en producción: los códigos OTP se imprimen en el log y NO se envían por correo.",
      );
    }
    return warnings;
  }
  fromAddress(); // lanza si falta el remitente
  if (sender.name === "brevo" && !getEnv("BREVO_API_KEY", "").trim()) {
    throw new Error("BREVO_API_KEY es obligatoria con CORTEX_EMAIL_PROVIDER=brevo.");
  }
  if (sender.name === "smtp" && !getEnv("SMTP_HOST", "").trim()) {
    throw new Error("SMTP_HOST es obligatorio con CORTEX_EMAIL_PROVIDER=smtp.");
  }
  return warnings;
}

/** Envía el código de acceso de un solo uso. */
export async function sendOtpEmail(email: string, code: string): Promise<void> {
  const brand = getBrandName();
  await getEmailSender().send({
    to: email,
    subject: `Tu código de acceso a ${brand}`,
    // El literal "código OTP para <email>: <code>" es el contrato que capturan los tests
    // de integración del flujo de auth; no lo cambies sin actualizarlos.
    text: `código OTP para ${email}: ${code}`,
    html:
      `<p>Hola,</p><p>Tu código de acceso a <b>${brand}</b> es:</p>` +
      `<p style="font-size:28px;font-weight:700;letter-spacing:4px">${code}</p>` +
      `<p>Caduca en unos minutos. Si no lo has solicitado, ignora este correo.</p>`,
  });
}

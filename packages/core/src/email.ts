/**
 * Envío de email transaccional vía Brevo (api.brevo.com). Enchufable: si no hay
 * `BREVO_API_KEY`, cae a modo DEV (loguea el código por stderr en vez de enviarlo),
 * para poder probar el flujo de auth sin enviar correos reales.
 */
const BREVO_ENDPOINT = "https://api.brevo.com/v3/smtp/email";

export async function sendOtpEmail(email: string, code: string): Promise<void> {
  const key = process.env.BREVO_API_KEY;
  if (!key) {
    console.log(`[auth dev] (sin BREVO_API_KEY) código OTP para ${email}: ${code}`);
    return;
  }
  const sender = process.env.BREVO_SENDER || "no-reply@dinacode.com";
  const senderName = process.env.BREVO_SENDER_NAME || "Dinacode Cortex";
  const res = await fetch(BREVO_ENDPOINT, {
    method: "POST",
    headers: { "api-key": key, "content-type": "application/json", accept: "application/json" },
    body: JSON.stringify({
      sender: { email: sender, name: senderName },
      to: [{ email }],
      subject: "Tu código de acceso a Dinacode Cortex",
      htmlContent:
        `<p>Hola,</p><p>Tu código de acceso a <b>Dinacode Cortex</b> es:</p>` +
        `<p style="font-size:28px;font-weight:700;letter-spacing:4px">${code}</p>` +
        `<p>Caduca en unos minutos. Si no lo has solicitado, ignora este correo.</p>`,
    }),
  });
  if (!res.ok) throw new Error(`Brevo ${res.status}: ${(await res.text()).slice(0, 200)}`);
}

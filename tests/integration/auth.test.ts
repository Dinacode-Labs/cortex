import { describe, it, expect, afterAll } from "vitest";
import { closeSql } from "@cortex/database";
import { requestOtp, verifyOtp, validateToken, createUiTicket, redeemUiTicket } from "@cortex/core";

const RID = Date.now().toString(36);
const EMAIL = `dev-${RID}@example.com`;
afterAll(async () => {
  await closeSql();
});

/** En modo dev (sin BREVO_API_KEY) el OTP se loguea por stdout; lo capturamos. */
async function otpFor(email: string): Promise<string> {
  let cap = "";
  const orig = console.log;
  console.log = ((...a: unknown[]) => {
    cap += a.join(" ");
  }) as typeof console.log;
  try {
    await requestOtp(email);
  } finally {
    console.log = orig;
  }
  const m = cap.match(/(\d{6})/);
  if (!m) throw new Error("no se capturó el OTP (¿BREVO_API_KEY activo?)");
  return m[1]!;
}

describe("auth email + OTP (BD real)", () => {
  it("flujo completo: OTP → token → validate → ticket de un solo uso", async () => {
    const code = await otpFor(EMAIL);
    const { token, user } = await verifyOtp(EMAIL, code);
    expect(user.email).toBe(EMAIL);

    expect((await validateToken(token))?.email).toBe(EMAIL);

    const ticket = await createUiTicket(token);
    expect(ticket).toBeTruthy();
    const redeemed = await redeemUiTicket(ticket!);
    expect(redeemed?.user.email).toBe(EMAIL);
    expect(redeemed!.token).not.toBe(token); // sesión web nueva (≠ token CLI)
    expect(await redeemUiTicket(ticket!)).toBeNull(); // un solo uso
  });

  it("código incorrecto y dominio no permitido se rechazan", async () => {
    await otpFor(EMAIL);
    await expect(verifyOtp(EMAIL, "000000")).rejects.toThrow();
    await expect(requestOtp("intruso@gmail.com")).rejects.toThrow(); // fuera de la whitelist
  });

  it("rate limit: no más de CORTEX_OTP_RATE_MAX (def. 5) códigos por email en la ventana", async () => {
    const email = `rate-${RID}@example.com`;
    for (let i = 0; i < 5; i++) await requestOtp(email); // 5 OK
    await expect(requestOtp(email)).rejects.toThrow(/Demasiadas solicitudes/); // el 6º se corta
  });

  it("bloqueo por intentos: tras 5 códigos erróneos ni el correcto sirve", async () => {
    const email = `lock-${RID}@example.com`;
    const code = await otpFor(email);
    for (let i = 0; i < 5; i++) await expect(verifyOtp(email, "000000")).rejects.toThrow(/incorrecto/i);
    // El código ya no es válido aunque sea el correcto (intentos agotados).
    await expect(verifyOtp(email, code)).rejects.toThrow(/Demasiados intentos/);
  });
});

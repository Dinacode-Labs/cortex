import { describe, it, expect, afterAll } from "vitest";
import { closeSql } from "@cortex/database";
import { requestOtp, verifyOtp, validateToken, createUiTicket, redeemUiTicket } from "@cortex/core";

const RID = Date.now().toString(36);
const EMAIL = `dev-${RID}@example.com`;
afterAll(async () => {
  await closeSql();
});

/** In dev mode (with no BREVO_API_KEY) the OTP is logged to stdout; we capture it. */
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
  if (!m) throw new Error("the OTP was not captured (is BREVO_API_KEY set?)");
  return m[1]!;
}

describe("auth email + OTP (a real database)", () => {
  it("the whole flow: OTP → token → validate → single-use ticket", async () => {
    const code = await otpFor(EMAIL);
    const { token, user } = await verifyOtp(EMAIL, code);
    expect(user.email).toBe(EMAIL);

    expect((await validateToken(token))?.email).toBe(EMAIL);

    const ticket = await createUiTicket(token);
    expect(ticket).toBeTruthy();
    const redeemed = await redeemUiTicket(ticket!);
    expect(redeemed?.user.email).toBe(EMAIL);
    expect(redeemed!.token).not.toBe(token); // a fresh web session (not the CLI token)
    expect(await redeemUiTicket(ticket!)).toBeNull();
  });

  it("a wrong code and a disallowed domain are both rejected", async () => {
    await otpFor(EMAIL);
    await expect(verifyOtp(EMAIL, "000000")).rejects.toThrow();
    await expect(requestOtp("outsider@gmail.com")).rejects.toThrow();
  });

  it("rate limit: no more than CORTEX_OTP_RATE_MAX (default 5) codes per email in the window", async () => {
    const email = `rate-${RID}@example.com`;
    for (let i = 0; i < 5; i++) await requestOtp(email);
    await expect(requestOtp(email)).rejects.toThrow(/Too many codes/);
  });

  it("attempt lockout: after 5 wrong codes, not even the right one works", async () => {
    const email = `lock-${RID}@example.com`;
    const code = await otpFor(email);
    for (let i = 0; i < 5; i++) await expect(verifyOtp(email, "000000")).rejects.toThrow(/Wrong code/i);
    // The code is no longer valid even when it is the right one (attempts exhausted).
    await expect(verifyOtp(email, code)).rejects.toThrow(/Too many attempts/);
  });
});

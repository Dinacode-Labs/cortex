import { randomBytes, randomInt } from "node:crypto";
import { port } from "../../composition.js";
import {
  OTP_REFUSALS,
  authDomains,
  hashSecret,
  isAllowedEmail,
  judgeOtp,
  normalizeEmail,
  otpRateMax,
  otpRateWindowMin,
  otpTtlMin,
  tokenTtlDays,
  uiTicketTtlSec,
  type Account,
} from "../domain/auth.js";
import type { SessionUser } from "../domain/session-user.js";
import { sendOtpEmail } from "./otp-email.js";

const newSecret = (bytes: number): string => randomBytes(bytes).toString("base64url");

export async function requestOtp(emailRaw: string): Promise<void> {
  const email = normalizeEmail(emailRaw);
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) throw new Error("That does not look like an email address.");
  if (!isAllowedEmail(email)) throw new Error(`That email domain is not allowed here (only: ${authDomains().join(", ") || "—"}).`);
  const auth = port("auth");
  if ((await auth.countOtpsSince(email, otpRateWindowMin())) >= otpRateMax()) {
    throw new Error("Too many codes requested. Wait a few minutes and try again.");
  }
  const code = String(randomInt(0, 1_000_000)).padStart(6, "0");
  await auth.replaceOtp(email, hashSecret(code), otpTtlMin());
  await sendOtpEmail(email, code);
}

export async function verifyOtp(emailRaw: string, codeRaw: string): Promise<{ token: string; account: Account }> {
  const email = normalizeEmail(emailRaw);
  const codeHash = hashSecret(codeRaw.trim());
  const token = newSecret(32);
  const result = await port("auth").verifyOtp(email, (otp) => judgeOtp(otp, codeHash), {
    tokenHash: hashSecret(token),
    ttlDays: tokenTtlDays(),
  });
  if (result.verdict !== "valid") throw new Error(OTP_REFUSALS[result.verdict]);
  return { token, account: result.account };
}

export async function authenticateAccount(token: string): Promise<Account | null> {
  if (!token) return null;
  return port("auth").accountByToken(hashSecret(token));
}

/** The single way a request's token becomes the caller every other part of core works with. */
export async function authenticate(token: string): Promise<SessionUser | null> {
  return (await authenticateAccount(token))?.user ?? null;
}

export async function revokeToken(token: string): Promise<void> {
  await port("auth").revokeToken(hashSecret(token));
}

/** The ticket is NOT the token: the web exchanges it for a session of its own (`cortex ui`). */
export async function createUiTicket(cliToken: string): Promise<string | null> {
  const account = await authenticateAccount(cliToken);
  if (!account) return null;
  const ticket = newSecret(24);
  await port("auth").createUiTicket(hashSecret(ticket), account.id, uiTicketTtlSec());
  return ticket;
}

export async function redeemUiTicket(ticket: string): Promise<{ token: string; account: Account } | null> {
  if (!ticket) return null;
  const token = newSecret(32);
  const issued = { tokenHash: hashSecret(token), ttlDays: tokenTtlDays() };
  const account = await port("auth").redeemUiTicket(hashSecret(ticket), issued);
  return account ? { token, account } : null;
}

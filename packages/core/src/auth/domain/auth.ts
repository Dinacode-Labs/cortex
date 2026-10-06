import { createHash } from "node:crypto";
import { getEnvNum } from "@cortex/shared";
import type { SessionUser } from "./session-user.js";

/**
 * Email + OTP authentication (no passwords). Codes and tokens are stored HASHED. A user IS their
 * email address.
 */
export const MAX_OTP_ATTEMPTS = 5;

export const hashSecret = (s: string): string => createHash("sha256").update(s).digest("hex");
export const normalizeEmail = (e: string): string => e.trim().toLowerCase();
const csv = (v: string | undefined): string[] => (v ?? "").split(",").map((s) => s.trim().toLowerCase()).filter(Boolean);

// Config read LAZILY (not on module load): robust against the order of loadEnv/imports.
export const otpTtlMin = (): number => getEnvNum("CORTEX_OTP_TTL_MIN", 10);
export const tokenTtlDays = (): number => getEnvNum("CORTEX_TOKEN_TTL_DAYS", 30);
export const otpRateMax = (): number => getEnvNum("CORTEX_OTP_RATE_MAX", 5);
export const otpRateWindowMin = (): number => getEnvNum("CORTEX_OTP_RATE_WINDOW_MIN", 15);
export const uiTicketTtlSec = (): number => getEnvNum("CORTEX_UI_TICKET_TTL_SEC", 90);
// No default: the allowed domain depends on whoever deploys. Empty = anyone can register (the
// server warns on startup); inheriting somebody else's domain would be worse.
export const authDomains = (): string[] => csv(process.env.CORTEX_AUTH_DOMAIN ?? "");
const adminEmails = (): string[] => csv(process.env.CORTEX_ADMIN_EMAIL);

export function isAllowedEmail(emailRaw: string): boolean {
  const email = normalizeEmail(emailRaw);
  const domains = authDomains();
  return domains.length === 0 || domains.some((d) => email.endsWith(`@${d}`));
}

export function isAdmin(user: SessionUser | null): boolean {
  return !!user && adminEmails().includes(normalizeEmail(user.email));
}

export function listAdmins(): string[] {
  return adminEmails();
}

/** The user row behind a session. The id only matters to auth itself (it keys tokens and tickets)
 * and to the HTTP contract that has always returned it, so it stays out of `SessionUser`. */
export interface Account {
  readonly id: string;
  readonly user: SessionUser;
}

export interface StoredOtp {
  id: string;
  codeHash: string;
  attempts: number;
}

export type OtpVerdict = "expired" | "exhausted" | "wrong" | "valid";

export function judgeOtp(otp: StoredOtp | null, codeHash: string): OtpVerdict {
  if (!otp) return "expired";
  if (otp.attempts >= MAX_OTP_ATTEMPTS) return "exhausted";
  return otp.codeHash === codeHash ? "valid" : "wrong";
}

export const OTP_REFUSALS: Record<Exclude<OtpVerdict, "valid">, string> = {
  expired: "That code has expired or never existed. Ask for a new one.",
  exhausted: "Too many attempts. Ask for a new code.",
  wrong: "Wrong code.",
};

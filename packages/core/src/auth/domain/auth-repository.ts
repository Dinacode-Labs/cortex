import type { Account, OtpVerdict, StoredOtp } from "./auth.js";

export interface IssuedToken {
  tokenHash: string;
  ttlDays: number;
}

export interface AuthRepository {
  countOtpsSince(email: string, windowMin: number): Promise<number>;
  replaceOtp(email: string, codeHash: string, ttlMin: number): Promise<void>;
  /** In one transaction: the latest live code, locked, is judged; a valid one signs the user in and issues the token. */
  verifyOtp(
    email: string,
    judge: (otp: StoredOtp | null) => OtpVerdict,
    token: IssuedToken,
  ): Promise<{ verdict: "valid"; account: Account } | { verdict: Exclude<OtpVerdict, "valid"> }>;
  accountByToken(tokenHash: string): Promise<Account | null>;
  revokeToken(tokenHash: string): Promise<void>;
  createUiTicket(ticketHash: string, userId: string, ttlSec: number): Promise<void>;
  /** Single use: the ticket is claimed atomically before a new token is issued. */
  redeemUiTicket(ticketHash: string, token: IssuedToken): Promise<Account | null>;
}

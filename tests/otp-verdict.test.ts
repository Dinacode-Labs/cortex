import { describe, it, expect } from "vitest";
import { MAX_OTP_ATTEMPTS, judgeOtp, type StoredOtp } from "../packages/core/src/auth/domain/auth";

const otp = (attempts: number): StoredOtp => ({ id: "o1", codeHash: "right", attempts });

/**
 * The OTP is the only way in: a code that kept accepting guesses past the limit, or a right code
 * refused because the order of the checks changed, would either open the door or lock it.
 */
describe("judging a sign-in code", () => {
  it("is expired when there is no live code, and exhausted at the attempt limit even when it is right", () => {
    expect({
      none: judgeOtp(null, "right"),
      exhausted: judgeOtp(otp(MAX_OTP_ATTEMPTS), "right"),
    }).toEqual({ none: "expired", exhausted: "exhausted" });
  });

  it("is wrong or valid by its hash while there are attempts left", () => {
    expect({
      wrong: judgeOtp(otp(MAX_OTP_ATTEMPTS - 1), "guess"),
      valid: judgeOtp(otp(MAX_OTP_ATTEMPTS - 1), "right"),
    }).toEqual({ wrong: "wrong", valid: "valid" });
  });
});

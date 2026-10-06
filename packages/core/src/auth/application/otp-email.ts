import { getBrandName } from "@cortex/shared";
import { port } from "../../composition.js";

export async function sendOtpEmail(email: string, code: string): Promise<void> {
  const brand = getBrandName();
  await port("email").send({
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

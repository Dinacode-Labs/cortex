import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import {
  getEmailSender,
  sendOtpEmail,
  setEmailSender,
  validateEmailConfig,
  type EmailMessage,
} from "@cortex/core";

/**
 * The OTP is the product's only front door: if sending is misconfigured, nobody gets in. That
 * is why the provider is pluggable (ADR-0028) and the config is validated at startup rather
 * than failing on the first login.
 *
 * A contract that must NOT be broken: in `log` mode, the printed line contains the 6-digit
 * code -- the auth flow's integration tests capture it from there.
 */
const VARS = [
  "CORTEX_EMAIL_PROVIDER", "CORTEX_EMAIL_FROM", "CORTEX_EMAIL_FROM_NAME",
  "BREVO_API_KEY", "BREVO_SENDER", "BREVO_SENDER_NAME",
  "SMTP_HOST", "SMTP_PORT", "SMTP_USER", "SMTP_PASS", "SMTP_SECURE",
  "CORTEX_BRAND_NAME", "NODE_ENV",
];

beforeEach(() => {
  for (const v of VARS) vi.stubEnv(v, "");
  setEmailSender(undefined);
});
afterEach(() => {
  vi.unstubAllEnvs();
  setEmailSender(undefined);
  vi.restoreAllMocks();
});

describe("provider selection", () => {
  it("with nothing configured it uses `log` (login can be tried with no credentials)", () => {
    expect(getEmailSender().name).toBe("log");
  });

  it("with BREVO_API_KEY and no CORTEX_EMAIL_PROVIDER it assumes brevo (compatibility)", () => {
    vi.stubEnv("BREVO_API_KEY", "k");
    expect(getEmailSender().name).toBe("brevo");
  });

  it("CORTEX_EMAIL_PROVIDER wins over the heuristic", () => {
    vi.stubEnv("BREVO_API_KEY", "k");
    vi.stubEnv("CORTEX_EMAIL_PROVIDER", "log");
    expect(getEmailSender().name).toBe("log");
  });

  it("an unknown provider fails, listing the valid options", () => {
    vi.stubEnv("CORTEX_EMAIL_PROVIDER", "sendgrid");
    expect(() => getEmailSender()).toThrow(/log \| brevo \| smtp/);
  });
});

describe("validateEmailConfig", () => {
  it("brevo with no sender does not start", () => {
    vi.stubEnv("CORTEX_EMAIL_PROVIDER", "brevo");
    vi.stubEnv("BREVO_API_KEY", "k");
    expect(() => validateEmailConfig()).toThrow(/CORTEX_EMAIL_FROM/);
  });

  it("brevo with no key does not start", () => {
    vi.stubEnv("CORTEX_EMAIL_PROVIDER", "brevo");
    vi.stubEnv("CORTEX_EMAIL_FROM", "no-reply@example.com");
    expect(() => validateEmailConfig()).toThrow(/BREVO_API_KEY/);
  });

  it("smtp with no host does not start", () => {
    vi.stubEnv("CORTEX_EMAIL_PROVIDER", "smtp");
    vi.stubEnv("CORTEX_EMAIL_FROM", "no-reply@example.com");
    expect(() => validateEmailConfig()).toThrow(/SMTP_HOST/);
  });

  it("a complete smtp config passes validation", () => {
    vi.stubEnv("CORTEX_EMAIL_PROVIDER", "smtp");
    vi.stubEnv("CORTEX_EMAIL_FROM", "no-reply@example.com");
    vi.stubEnv("SMTP_HOST", "smtp.example.com");
    expect(validateEmailConfig()).toEqual([]);
  });

  it("warns (without breaking) when in production the OTPs are only logged", () => {
    vi.stubEnv("NODE_ENV", "production");
    const warnings = validateEmailConfig();
    expect(warnings).toHaveLength(1);
    expect(warnings[0]).toMatch(/not emailed/i);
  });

  it("accepts the old BREVO_SENDER names as aliases for the sender", () => {
    vi.stubEnv("CORTEX_EMAIL_PROVIDER", "brevo");
    vi.stubEnv("BREVO_API_KEY", "k");
    vi.stubEnv("BREVO_SENDER", "no-reply@example.com");
    expect(validateEmailConfig()).toEqual([]);
  });
});

describe("sendOtpEmail", () => {
  it("in log mode it prints the 6-digit code (the auth tests' contract)", async () => {
    const spy = vi.spyOn(console, "log").mockImplementation(() => {});
    await sendOtpEmail("dev@example.com", "123456");
    const printed = spy.mock.calls.map((c) => c.join(" ")).join("\n");
    expect(printed).toMatch(/\d{6}/);
    expect(printed).toContain("dev@example.com");
  });

  it("uses the configured brand in the subject", async () => {
    vi.stubEnv("CORTEX_BRAND_NAME", "Acme Memory");
    const sent: EmailMessage[] = [];
    setEmailSender({ name: "test", async send(m) { sent.push(m); } });
    await sendOtpEmail("dev@example.com", "123456");
    expect(sent[0]!.subject).toContain("Acme Memory");
    expect(sent[0]!.html).toContain("123456");
  });

  it("an injected sender beats the environment configuration", async () => {
    vi.stubEnv("BREVO_API_KEY", "k"); // it would pick brevo were there no override
    let called = false;
    setEmailSender({ name: "test", async send() { called = true; } });
    await sendOtpEmail("dev@example.com", "000000");
    expect(called).toBe(true);
  });
});

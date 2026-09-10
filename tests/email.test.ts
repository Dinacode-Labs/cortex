import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import {
  getEmailSender,
  sendOtpEmail,
  setEmailSender,
  validateEmailConfig,
  type EmailMessage,
} from "@cortex/core";

/**
 * El OTP es la única puerta de entrada al producto: si el envío está mal configurado, nadie
 * entra. Por eso el proveedor es enchufable (ADR-0028) y la config se valida al arrancar
 * en vez de fallar en el primer login.
 *
 * Contrato que NO se puede romper: en modo `log`, la línea impresa contiene el código de 6
 * dígitos — los tests de integración del flujo de auth lo capturan de ahí.
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

describe("selección de proveedor", () => {
  it("sin configurar nada usa `log` (se puede probar el login sin credenciales)", () => {
    expect(getEmailSender().name).toBe("log");
  });

  it("con BREVO_API_KEY y sin CORTEX_EMAIL_PROVIDER asume brevo (compatibilidad)", () => {
    vi.stubEnv("BREVO_API_KEY", "k");
    expect(getEmailSender().name).toBe("brevo");
  });

  it("CORTEX_EMAIL_PROVIDER manda sobre la heurística", () => {
    vi.stubEnv("BREVO_API_KEY", "k");
    vi.stubEnv("CORTEX_EMAIL_PROVIDER", "log");
    expect(getEmailSender().name).toBe("log");
  });

  it("un proveedor desconocido falla con las opciones válidas", () => {
    vi.stubEnv("CORTEX_EMAIL_PROVIDER", "sendgrid");
    expect(() => getEmailSender()).toThrow(/log \| brevo \| smtp/);
  });
});

describe("validateEmailConfig", () => {
  it("brevo sin remitente no arranca", () => {
    vi.stubEnv("CORTEX_EMAIL_PROVIDER", "brevo");
    vi.stubEnv("BREVO_API_KEY", "k");
    expect(() => validateEmailConfig()).toThrow(/CORTEX_EMAIL_FROM/);
  });

  it("brevo sin clave no arranca", () => {
    vi.stubEnv("CORTEX_EMAIL_PROVIDER", "brevo");
    vi.stubEnv("CORTEX_EMAIL_FROM", "no-reply@example.com");
    expect(() => validateEmailConfig()).toThrow(/BREVO_API_KEY/);
  });

  it("smtp sin host no arranca", () => {
    vi.stubEnv("CORTEX_EMAIL_PROVIDER", "smtp");
    vi.stubEnv("CORTEX_EMAIL_FROM", "no-reply@example.com");
    expect(() => validateEmailConfig()).toThrow(/SMTP_HOST/);
  });

  it("config completa de smtp pasa la validación", () => {
    vi.stubEnv("CORTEX_EMAIL_PROVIDER", "smtp");
    vi.stubEnv("CORTEX_EMAIL_FROM", "no-reply@example.com");
    vi.stubEnv("SMTP_HOST", "smtp.example.com");
    expect(validateEmailConfig()).toEqual([]);
  });

  it("avisa (sin romper) si en producción los OTP solo se loguean", () => {
    vi.stubEnv("NODE_ENV", "production");
    const warnings = validateEmailConfig();
    expect(warnings).toHaveLength(1);
    expect(warnings[0]).toMatch(/no se envían|NO se envían/i);
  });

  it("acepta los nombres antiguos BREVO_SENDER como alias del remitente", () => {
    vi.stubEnv("CORTEX_EMAIL_PROVIDER", "brevo");
    vi.stubEnv("BREVO_API_KEY", "k");
    vi.stubEnv("BREVO_SENDER", "no-reply@example.com");
    expect(validateEmailConfig()).toEqual([]);
  });
});

describe("sendOtpEmail", () => {
  it("en modo log imprime el código de 6 dígitos (contrato de los tests de auth)", async () => {
    const spy = vi.spyOn(console, "log").mockImplementation(() => {});
    await sendOtpEmail("dev@example.com", "123456");
    const printed = spy.mock.calls.map((c) => c.join(" ")).join("\n");
    expect(printed).toMatch(/\d{6}/);
    expect(printed).toContain("dev@example.com");
  });

  it("usa la marca configurada en el asunto", async () => {
    vi.stubEnv("CORTEX_BRAND_NAME", "Acme Memory");
    const sent: EmailMessage[] = [];
    setEmailSender({ name: "test", async send(m) { sent.push(m); } });
    await sendOtpEmail("dev@example.com", "123456");
    expect(sent[0]!.subject).toContain("Acme Memory");
    expect(sent[0]!.html).toContain("123456");
  });

  it("un sender inyectado gana a la configuración por entorno", async () => {
    vi.stubEnv("BREVO_API_KEY", "k"); // haría brevo si no hubiera override
    let called = false;
    setEmailSender({ name: "test", async send() { called = true; } });
    await sendOtpEmail("dev@example.com", "000000");
    expect(called).toBe(true);
  });
});

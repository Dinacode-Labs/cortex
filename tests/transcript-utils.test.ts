import { describe, it, expect } from "vitest";
import { scrub } from "../packages/agents/src/transcript-utils";

/**
 * scrub() es código de SEGURIDAD: redacta secretos del transcript de una sesión ANTES
 * de mandarlo al LLM o de guardarlo. Estos tests fijan qué patrones cubre de verdad
 * (ver la implementación en transcript-utils.ts) para que un cambio no los rompa en
 * silencio. Cada caso usa un secreto SINTÉTICO (no real).
 */
describe("scrub — redacción de secretos", () => {
  it("redacta bloques de clave privada PEM", () => {
    const s = scrub("clave:\n-----BEGIN RSA PRIVATE KEY-----\nMIIabc123DEF456\n-----END RSA PRIVATE KEY-----\nfin");
    expect(s).toContain("[REDACTED_KEY]");
    expect(s).not.toContain("MIIabc123DEF456");
  });

  it("redacta JWT (eyJ...)", () => {
    const jwt = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiIxMjM0NTY.abc123defg";
    const s = scrub(`token: ${jwt}`);
    expect(s).toContain("[REDACTED_JWT]");
    expect(s).not.toContain(jwt);
  });

  it("redacta claves OpenAI (sk-...)", () => {
    const s = scrub("OPENAI: sk-abcDEF123456ghiJKL789");
    expect(s).toContain("[REDACTED]");
    expect(s).not.toContain("sk-abcDEF123456ghiJKL789");
  });

  it("redacta tokens de GitHub (ghp_/github_pat_)", () => {
    const s = scrub("ghp_ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789 y github_pat_ABCDEFGHIJKLMNOPQRSTUV");
    expect(s).not.toContain("ghp_ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789");
    expect(s).not.toContain("github_pat_ABCDEFGHIJKLMNOPQRSTUV");
  });

  it("redacta claves AWS (AKIA...) y Google (AIza.../GOCSPX-)", () => {
    const s = scrub("AKIAIOSFODNN7EXAMPLE / AIzaSyA1234567890abcdefghij_KLM / GOCSPX-abcdefghij123");
    expect(s).not.toContain("AKIAIOSFODNN7EXAMPLE");
    expect(s).not.toContain("AIzaSyA1234567890abcdefghij_KLM");
    expect(s).not.toContain("GOCSPX-abcdefghij123");
  });

  it("redacta 'Bearer <token>' conservando la palabra Bearer", () => {
    const s = scrub("Authorization: Bearer abcdef0123456789XYZ");
    expect(s).toContain("Bearer [REDACTED]");
    expect(s).not.toContain("abcdef0123456789XYZ");
  });

  it("redacta pares clave/valor (api_key=, token:, password=...)", () => {
    const s = scrub('api_key="abcdef0123456789" y password = secreto_larguisimo_1234');
    expect(s).toContain("[REDACTED]");
    expect(s).not.toContain("abcdef0123456789");
    expect(s).not.toContain("secreto_larguisimo_1234");
  });

  it("NO destroza texto normal", () => {
    const normal = "Decidimos usar RabbitMQ para las exportaciones asíncronas y evitar timeouts.";
    expect(scrub(normal)).toBe(normal);
  });
});

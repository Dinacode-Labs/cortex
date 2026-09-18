import { describe, it, expect } from "vitest";
import { scrub } from "../packages/client/src/transcript-utils";

/**
 * scrub() is SECURITY code: it redacts secrets from a session's transcript BEFORE sending it to
 * the LLM or storing it. These tests pin which patterns it really covers (see the
 * implementation in transcript-utils.ts) so a change does not break them silently. Every case
 * uses a SYNTHETIC secret (never a real one).
 */
describe("scrub — secret redaction", () => {
  it("redacts PEM private key blocks", () => {
    const s = scrub("key:\n-----BEGIN RSA PRIVATE KEY-----\nMIIabc123DEF456\n-----END RSA PRIVATE KEY-----\nend");
    expect(s).toContain("[REDACTED_KEY]");
    expect(s).not.toContain("MIIabc123DEF456");
  });

  it("redacts JWTs (eyJ...)", () => {
    const jwt = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiIxMjM0NTY.abc123defg";
    const s = scrub(`token: ${jwt}`);
    expect(s).toContain("[REDACTED_JWT]");
    expect(s).not.toContain(jwt);
  });

  it("redacts OpenAI keys (sk-...)", () => {
    const s = scrub("OPENAI: sk-abcDEF123456ghiJKL789");
    expect(s).toContain("[REDACTED]");
    expect(s).not.toContain("sk-abcDEF123456ghiJKL789");
  });

  it("redacts GitHub tokens (ghp_/github_pat_)", () => {
    const s = scrub("ghp_ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789 y github_pat_ABCDEFGHIJKLMNOPQRSTUV");
    expect(s).not.toContain("ghp_ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789");
    expect(s).not.toContain("github_pat_ABCDEFGHIJKLMNOPQRSTUV");
  });

  it("redacts AWS keys (AKIA...) and Google ones (AIza.../GOCSPX-)", () => {
    const s = scrub("AKIAIOSFODNN7EXAMPLE / AIzaSyA1234567890abcdefghij_KLM / GOCSPX-abcdefghij123");
    expect(s).not.toContain("AKIAIOSFODNN7EXAMPLE");
    expect(s).not.toContain("AIzaSyA1234567890abcdefghij_KLM");
    expect(s).not.toContain("GOCSPX-abcdefghij123");
  });

  it("redacts 'Bearer <token>' while keeping the word Bearer", () => {
    const s = scrub("Authorization: Bearer abcdef0123456789XYZ");
    expect(s).toContain("Bearer [REDACTED]");
    expect(s).not.toContain("abcdef0123456789XYZ");
  });

  it("redacts key/value pairs (api_key=, token:, password=...)", () => {
    const s = scrub('api_key="abcdef0123456789" y password = secreto_larguisimo_1234');
    expect(s).toContain("[REDACTED]");
    expect(s).not.toContain("abcdef0123456789");
    expect(s).not.toContain("secreto_larguisimo_1234");
  });

  it("does NOT mangle ordinary text", () => {
    const normal = "We decided to use RabbitMQ for the asynchronous exports and avoid timeouts.";
    expect(scrub(normal)).toBe(normal);
  });
});

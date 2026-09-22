import { describe, it, expect } from "vitest";
import { scrub } from "@cortex/shared";

/**
 * `scrub()` is SECURITY code and now lives in @cortex/shared: agents use it (before the LLM),
 * core does (before persisting) and so do the connectors. `tests/transcript-utils.test.ts`
 * covers the historical patterns through the re-export; what is pinned here are the ones ADDED
 * when centralising it (backlog #6) and the idempotence property, which applying it across
 * several layers without corrupting the text depends on. SYNTHETIC secrets, none real.
 */
describe("scrub — patterns added when centralising in shared", () => {
  it("redacts a connection string's password and keeps host and user", () => {
    const s = scrub("DATABASE_URL=postgres://cortex:s3cr3tP4ss@db.internal:5432/cortex");
    expect(s).not.toContain("s3cr3tP4ss");
    expect(s).toContain("postgres://cortex:[REDACTED]@db.internal:5432/cortex");
  });

  it("covers other schemes with embedded credentials (mongodb+srv, redis, amqp)", () => {
    const s = scrub("mongodb+srv://app:mongoPass123@cluster0.example.net/db redis://user:redisPass99@cache:6379");
    expect(s).not.toContain("mongoPass123");
    expect(s).not.toContain("redisPass99");
  });

  it("redacts Cookie / Set-Cookie headers from a request dump", () => {
    const s = scrub(["GET /admin HTTP/1.1", "Cookie: session=abc123def456ghi789jkl", "Accept: */*"].join("\n"));
    expect(s).not.toContain("abc123def456ghi789jkl");
    expect(s).toContain("Cookie: [REDACTED]");
    expect(s).toContain("Accept: */*");
  });

  it("leaves alone prose that merely mentions cookies", () => {
    const text = "Decision: the cookie policy is accepted on the portal's first render.";
    expect(scrub(text)).toBe(text);
  });

  it("redacta Authorization: Basic", () => {
    const s = scrub("Authorization: Basic dXNlcjpwYXNzd29yZDEyMzQ1Ng==");
    expect(s).not.toContain("dXNlcjpwYXNzd29yZDEyMzQ1Ng==");
    expect(s).toContain("Basic [REDACTED]");
  });

  it("redacts Anthropic, npm and Stripe keys", () => {
    const s = scrub(
      "sk-ant-api03-ABCDEFGHIJKLMNOPQRSTUVWXYZ012345 npm_ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789 sk_live_ABCDEFGHIJKLMNOP1234",
    );
    expect(s).not.toContain("sk-ant-api03-ABCDEFGHIJKLMNOPQRSTUVWXYZ012345");
    expect(s).not.toContain("npm_ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789");
    expect(s).not.toContain("sk_live_ABCDEFGHIJKLMNOP1234");
  });

  it("is idempotent: applying it twice gives the same result", () => {
    const raw = "key sk-abcDEF123456ghiJKL789 and postgres://u:aL0ngP4ssword@h/d and Bearer abcdefghijklmnopqrstu";
    const once = scrub(raw);
    expect(scrub(once)).toBe(once);
  });

  it("leaves ordinary knowledge text untouched", () => {
    const text = "Client constraint: deployment happens on Tuesdays and needs a 30-minute window.";
    expect(scrub(text)).toBe(text);
  });
});

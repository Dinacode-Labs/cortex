import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { clientIp, tooManyRequests, resetRateLimit } from "../apps/server/src/rate-limit.js";

/**
 * `requestOtp` already limits per email address, which stops one person being hammered. What it
 * did not stop is requesting codes for many different addresses from a single IP: each one
 * starts with a fresh allowance. With email sending switched on, those are real messages and a
 * real bill.
 */
describe("per-IP limit on sending codes", () => {
  beforeEach(() => resetRateLimit());
  afterEach(() => vi.unstubAllEnvs());

  it("lets through up to the cap and cuts off beyond it", () => {
    vi.stubEnv("CORTEX_AUTH_IP_MAX", "3");
    for (let i = 0; i < 3; i++) expect(tooManyRequests("1.2.3.4")).toBe(false);
    expect(tooManyRequests("1.2.3.4")).toBe(true);
    expect(tooManyRequests("1.2.3.4")).toBe(true);
  });

  it("each IP keeps its own count", () => {
    vi.stubEnv("CORTEX_AUTH_IP_MAX", "1");
    expect(tooManyRequests("1.1.1.1")).toBe(false);
    expect(tooManyRequests("2.2.2.2")).toBe(false);
    expect(tooManyRequests("1.1.1.1")).toBe(true);
  });

  it("once the window passes it starts again", () => {
    vi.stubEnv("CORTEX_AUTH_IP_MAX", "1");
    vi.stubEnv("CORTEX_AUTH_IP_WINDOW_MIN", "15");
    const t0 = 1_000_000;
    expect(tooManyRequests("9.9.9.9", t0)).toBe(false);
    expect(tooManyRequests("9.9.9.9", t0 + 1000)).toBe(true);
    expect(tooManyRequests("9.9.9.9", t0 + 16 * 60_000)).toBe(false);
  });

  /**
   * What really decides whether this is worth anything: which IP we trust. The first entry of
   * `x-forwarded-for` is written by the caller and can be made up; the last one is set by our
   * own proxy. Taking the first would turn the limit into decoration.
   */
  it("keeps the IP the proxy set, not the one the client claims", () => {
    const req = (cabeceras: Record<string, string>) =>
      ({ req: { header: (n: string) => cabeceras[n.toLowerCase()] } }) as never;

    expect(clientIp(req({ "x-forwarded-for": "9.9.9.9, 203.0.113.7" }))).toBe("203.0.113.7");
    expect(clientIp(req({ "x-forwarded-for": "203.0.113.7" }))).toBe("203.0.113.7");
    expect(clientIp(req({ "x-real-ip": "198.51.100.4" }))).toBe("198.51.100.4");
    expect(clientIp(req({}))).toBe("unknown");
  });

  it("every request with no known IP shares one budget, which is the prudent thing", () => {
    vi.stubEnv("CORTEX_AUTH_IP_MAX", "1");
    expect(tooManyRequests("unknown")).toBe(false);
    expect(tooManyRequests("unknown")).toBe(true);
  });
});

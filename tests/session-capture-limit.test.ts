import { describe, it, expect } from "vitest";
import { limitSession } from "../packages/client/src/session-capture.js";

/**
 * A long working session with an agent goes past the server's cap -- 154,000 characters in one
 * measured case -- and the server used to reject it whole with a 413. Those are precisely the
 * ones carrying the most knowledge: losing them means losing the day.
 */
describe("a session's size cap", () => {
  it("a normal session is not touched", () => {
    const s = "[user] which backoff do we use?\n[assistant] exponential, capped at 60s";
    expect(limitSession(s)).toBe(s);
  });

  it("one that is too long is trimmed until it fits", () => {
    const r = limitSession("x".repeat(154_035));
    expect(r.length).toBeLessThanOrEqual(150_000);
  });

  it("it is trimmed from the START: the end is where the conclusions are", () => {
    const start = "TANTEO-DEL-PRINCIPIO";
    const end = "DECISION-DEL-FINAL";
    const r = limitSession(start + "x".repeat(200) + end, 120);
    expect(r).toContain(end);
    expect(r).not.toContain(start);
  });

  it("leaves a marker, so distillation does not read the cut as the real beginning", () => {
    const r = limitSession("x".repeat(1000), 200);
    expect(r.startsWith("[...")).toBe(true);
    expect(r.length).toBeLessThanOrEqual(200);
  });
});

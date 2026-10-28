import { describe, it, expect } from "vitest";
import { endpointHost, fillDays, periodDays } from "../packages/core/src/observability/domain/usage";

/**
 * The usage chart draws one bar per day (ADR-0100). A period that starts at the server's midnight
 * rather than UTC's moves a day's spend into its neighbour, and a day missing from the series
 * draws a quiet week as a busy one.
 */
describe("the days a usage period covers", () => {
  it("end on today's UTC date, oldest first", () => {
    expect(periodDays(3, new Date("2026-10-27T23:30:00-05:00"))).toEqual(["2026-10-26", "2026-10-27", "2026-10-28"]);
  });

  it("are at least one, whatever length is asked for", () => {
    expect(periodDays(0, new Date("2026-10-27T12:00:00Z"))).toEqual(["2026-10-27"]);
  });

  it("count a day with no calls as a zero, not a gap", () => {
    const spent = [{ day: "2026-10-27", calls: 2, inputTokens: 10, outputTokens: 5, totalTokens: 15, costUsd: 0 }];

    expect(fillDays(["2026-10-26", "2026-10-27"], spent)).toEqual([
      { day: "2026-10-26", calls: 0, inputTokens: 0, outputTokens: 0, totalTokens: 0, costUsd: 0 },
      spent[0],
    ]);
  });
});

/**
 * The host is what tells one subscription from another: a self-hosted model and a paid one both
 * record `openai-compatible`. A base URL may carry a key in its user-info, and that must never
 * reach the usage table.
 */
describe("the endpoint a call is charged to", () => {
  it("is the host and its port, without credentials or path", () => {
    expect(endpointHost("https://user:secret@api.example.com:8443/v1")).toBe("api.example.com:8443");
  });

  it("is nothing when there is no URL, or it does not parse", () => {
    expect([endpointHost(undefined), endpointHost(""), endpointHost("not a url")]).toEqual([null, null, null]);
  });
});

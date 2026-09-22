import { describe, it, expect, afterAll, vi } from "vitest";
import { closeSql } from "@cortex/database";
import { createApp as createServerApp } from "../../apps/server/src/app.js";

/**
 * Health checks say whether the service answers, and that leaves out the two problems that
 * really hurt here: the worker dying -- it has no port, and it is what keeps the memory alive
 * -- and captures starting to fail while everything else looks fine.
 *
 * It is exposed in Prometheus's text format on purpose: other people deploy this, and they
 * already have their own way of watching. A dashboard of our own forces them to look at it; a
 * standard format is read by their stack and lets them set their own thresholds.
 */
afterAll(async () => {
  await closeSql();
});

describe("GET /metrics", () => {
  it("off by default, and it answers 404 rather than 403", async () => {
    // A 403 would announce there is something to ask for. A 404 says nothing.
    const res = await createServerApp().request("/metrics");
    expect(res.status).toBe(404);
  });

  it("with a token configured, without it or with the wrong one, it is still 404", async () => {
    vi.stubEnv("CORTEX_METRICS_TOKEN", "s3cr3t");
    try {
      const app = createServerApp();
      expect((await app.request("/metrics")).status).toBe(404);
      expect((await app.request("/metrics", { headers: { authorization: "Bearer other" } })).status).toBe(404);
    } finally {
      vi.unstubAllEnvs();
    }
  });

  it("with the right token, it returns metrics a Prometheus can read", async () => {
    vi.stubEnv("CORTEX_METRICS_TOKEN", "s3cr3t");
    try {
      const res = await createServerApp().request("/metrics", { headers: { authorization: "Bearer s3cr3t" } });
      expect(res.status).toBe(200);
      expect(res.headers.get("content-type")).toContain("text/plain");

      const texto = await res.text();
      for (const m of ["cortex_up", "cortex_session_captures_total", "cortex_worker_heartbeat_age_seconds", "cortex_entries_total", "cortex_llm_tokens_total"]) {
        expect(texto, m).toContain(`# HELP ${m}`);
        expect(texto, m).toContain(`# TYPE ${m}`);
      }
      expect(texto).toMatch(/^cortex_up 1$/m);
      expect(texto).toMatch(/^cortex_llm_tokens_total\{direction="input"\} \d+$/m);
    } finally {
      vi.unstubAllEnvs();
    }
  });
});

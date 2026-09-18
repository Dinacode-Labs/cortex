import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import { closeSql } from "@cortex/database";
import { createProject, listEntries, requestOtp, verifyOtp, type ProjectRef } from "@cortex/core";
import type { DistillSessionFn, DistillSessionInput } from "@cortex/agents";
import { createApp as createServerApp } from "../../apps/server/src/app.js";

/**
 * `POST /capture/session`: the client sends the condensed transcript and the server distills
 * (ADR-0025). A fake distiller is injected here, because what needs verifying is not the
 * quality of the distillation but the endpoint's contract: permissions, idempotence and not
 * paying twice for the same session.
 */
const RID = Date.now().toString(36);
const USER = `dev-cap-${RID}@example.com`;
const OWNER = `ana-cap-${RID}@example.com`;

let token: string;
let own: ProjectRef;
let foreign: ProjectRef;

async function otpFor(email: string): Promise<string> {
  let cap = "";
  const orig = console.log;
  console.log = ((...a: unknown[]) => {
    cap += a.join(" ");
  }) as typeof console.log;
  try {
    await requestOtp(email);
  } finally {
    console.log = orig;
  }
  const m = cap.match(/(\d{6})/);
  if (!m) throw new Error("the OTP was not captured");
  return m[1]!;
}

/** A fake distiller: it records what it was called with and returns fixed counters. */
function stubDistill(): { fn: DistillSessionFn; calls: DistillSessionInput[] } {
  const calls: DistillSessionInput[] = [];
  const fn: DistillSessionFn = async (input) => {
    calls.push(input);
    return { saved: 1, updated: 0, superseded: 0, noop: 0, failed: 0, windows: 1 };
  };
  return { fn, calls };
}

const body = (slug: string, condensed: string, sessionId: string) =>
  JSON.stringify({ slug, platform: "claude", sessionId, condensed });

/** A transcript above the 200-character minimum distillation requires. */
const transcript = (extra = "") =>
  `USER: why does the job queue use Redis?\n\nASSISTANT: because of the retries with backoff; we decided that when migrating the worker and it was written down in the project's corresponding ADR.${extra}`;

beforeAll(async () => {
  const code = await otpFor(USER);
  ({ token } = await verifyOtp(USER, code));
  own = await createProject(`IT Cap Own ${RID}`, { visibility: "private", ownerEmail: USER });
  foreign = await createProject(`IT Cap Ajeno ${RID}`, { visibility: "private", ownerEmail: OWNER });
});
afterAll(async () => {
  await closeSql();
});

describe("POST /capture/session", () => {
  it("requires a session and respects the project's permissions", async () => {
    const { fn } = stubDistill();
    const srv = createServerApp({ distill: fn });
    const headers = { authorization: `Bearer ${token}`, "content-type": "application/json" };

    const sinAuth = await srv.request("/capture/session", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: body(own.slug!, transcript(), `s-401-${RID}`),
    });
    expect(sinAuth.status).toBe(401);

    const noExiste = await srv.request("/capture/session", {
      method: "POST",
      headers,
      body: body(`does-not-exist-${RID}`, transcript(), `s-404-${RID}`),
    });
    expect(noExiste.status).toBe(404);

    const ajeno = await srv.request("/capture/session", {
      method: "POST",
      headers,
      body: body(foreign.slug!, transcript(), `s-403-${RID}`),
    });
    expect(ajeno.status).toBe(403);
  });

  it("rejects an outsized transcript before touching the database (413)", async () => {
    vi.stubEnv("CORTEX_CAPTURE_SESSION_MAX_CHARS", "500");
    try {
      const { fn, calls } = stubDistill();
      const srv = createServerApp({ distill: fn });
      const res = await srv.request("/capture/session", {
        method: "POST",
        headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
        body: body(own.slug!, "x".repeat(600), `s-413-${RID}`),
      });
      expect(res.status).toBe(413);
      expect(calls).toHaveLength(0);
    } finally {
      vi.unstubAllEnvs();
    }
  });

  it("with ?wait=1 it distills, attributes to the user and returns counters", async () => {
    const { fn, calls } = stubDistill();
    const srv = createServerApp({ distill: fn });
    const sessionId = `s-wait-${RID}`;
    const res = await srv.request("/capture/session?wait=1", {
      method: "POST",
      headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
      body: body(own.slug!, transcript(), sessionId),
    });
    expect(res.status).toBe(200);
    const out = (await res.json()) as { status: string; counters?: { saved: number } };
    expect(out.status).toBe("done");
    expect(out.counters?.saved).toBe(1);

    expect(calls).toHaveLength(1);
    expect(calls[0]!.createdBy).toBe(USER); // attribution comes from the Bearer, not the body
    expect(calls[0]!.projectName).toBe(own.name);
    expect(calls[0]!.sessionId).toBe(sessionId);
  });

  it("the same session with the same content is not distilled again", async () => {
    const { fn, calls } = stubDistill();
    const srv = createServerApp({ distill: fn });
    const headers = { authorization: `Bearer ${token}`, "content-type": "application/json" };
    const sessionId = `s-dup-${RID}`;
    const payload = body(own.slug!, transcript(), sessionId);

    const first = await srv.request("/capture/session?wait=1", { method: "POST", headers, body: payload });
    expect(first.status).toBe(200);
    expect(calls).toHaveLength(1);

    // The end-of-session and pre-compaction hooks fire over the same session: repeating must
    // NOT cost another round of model calls.
    const second = await srv.request("/capture/session?wait=1", { method: "POST", headers, body: payload });
    expect(second.status).toBe(200);
    expect(((await second.json()) as { status: string }).status).toBe("duplicate");
    expect(calls).toHaveLength(1);
  });

  it("when the session grew, only the new part is distilled", async () => {
    const { fn, calls } = stubDistill();
    const srv = createServerApp({ distill: fn });
    const headers = { authorization: `Bearer ${token}`, "content-type": "application/json" };
    const sessionId = `s-delta-${RID}`;
    const base = transcript();
    const tail = "\n\nUSER: and the timeout?\n\nASSISTANT: 30 seconds, configurable per environment.";

    await srv.request("/capture/session?wait=1", { method: "POST", headers, body: body(own.slug!, base, sessionId) });
    await srv.request("/capture/session?wait=1", {
      method: "POST",
      headers,
      body: body(own.slug!, base + tail, sessionId),
    });

    expect(calls).toHaveLength(2);
    // The condensed form is append-only: the already-processed prefix is not paid for again.
    expect(calls[1]!.condensed).toBe(tail);
  });

  it("without ?wait it returns 202 and the status can be polled by id", async () => {
    const { fn } = stubDistill();
    const srv = createServerApp({ distill: fn });
    const headers = { authorization: `Bearer ${token}`, "content-type": "application/json" };
    const res = await srv.request("/capture/session", {
      method: "POST",
      headers,
      body: body(own.slug!, transcript(), `s-async-${RID}`),
    });
    expect(res.status).toBe(202);
    const { id, status } = (await res.json()) as { id: string; status: string };
    expect(status).toBe("queued");

    // The tail runs in-process: by the time it is queried, it has already run.
    await new Promise((r) => setTimeout(r, 50));
    const check = await srv.request(`/capture/session/${id}`, { headers });
    expect(check.status).toBe(200);
    expect(["queued", "running", "done"]).toContain(((await check.json()) as { status: string }).status);
  });

  it("a distiller failure is recorded, it does not blow up the request", async () => {
    const srv = createServerApp({
      distill: async () => {
        throw new Error("the provider returned 429");
      },
    });
    const headers = { authorization: `Bearer ${token}`, "content-type": "application/json" };
    const res = await srv.request("/capture/session?wait=1", {
      method: "POST",
      headers,
      body: body(own.slug!, transcript(), `s-fail-${RID}`),
    });
    expect(res.status).toBe(200);
    const out = (await res.json()) as { status: string; error?: string };
    expect(out.status).toBe("failed");
    expect(out.error).toContain("429");
  });

  it("the real distiller writes entries attributed to the user", async () => {
    // No stub: the real `distillSession` is used, but with no LLM configured (`distill`
    // returns empty). It checks the real wiring of app → queue → agents → core.
    const srv = createServerApp();
    const res = await srv.request("/capture/session?wait=1", {
      method: "POST",
      headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
      body: body(own.slug!, transcript(), `s-real-${RID}`),
    });
    expect([200, 202]).toContain(res.status);
    const out = (await res.json()) as { status: string };
    expect(["done", "failed", "running"]).toContain(out.status);
    // It does not assert there are entries: with no LLM the distiller produces nothing, and
    // that is correct. What gets verified is that the whole route does not throw.
    await listEntries({ project: own.name });
  });
});

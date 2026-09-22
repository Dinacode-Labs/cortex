import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { closeSql } from "@cortex/database";
import { createProject, requestOtp, saveContext, verifyOtp, type ProjectRef } from "@cortex/core";
import { createApp as createServerApp } from "../../apps/server/src/app.js";

/**
 * `GET /search`, `GET /entries/:id` and `PATCH /entries/:id` (ADR-0034).
 *
 * What is tested here are the GUARDS, which is the real risk: until now the API could only
 * write, and opening up reading is exactly where somebody else's private project leaks. Search
 * without a `slug` is the most delicate, because it walks several projects at once.
 */
const RID = Date.now().toString(36);
const USER = `dev-entries-${RID}@example.com`;
const OWNER = `ana-entries-${RID}@example.com`;
const MARKER = `zxqmarker${RID}`; // an odd word: it appears in both entries and in nothing else

let token: string;
let other: ProjectRef;
let own: ProjectRef;
let ownId: string;
let otherId: string;

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

beforeAll(async () => {
  ({ token } = await verifyOtp(USER, await otpFor(USER)));
  other = await createProject(`IT Entries Prv ${RID}`, { visibility: "private", ownerEmail: OWNER });
  own = await createProject(`IT Entries Own ${RID}`, { visibility: "private", ownerEmail: USER });

  const a = await saveContext(
    { content: `Decision ${MARKER}: the hooks close stdin before waiting.`, project: own.name, title: `Own ${MARKER}`, type: "decision", createdBy: USER },
    { useClassifier: false },
  );
  ownId = a.entry.id;
  const b = await saveContext(
    { content: `Decision ${MARKER}: this belongs to somebody else's project.`, project: other.name, title: `Other ${MARKER}`, type: "decision", createdBy: OWNER },
    { useClassifier: false },
  );
  otherId = b.entry.id;
});

afterAll(async () => {
  await closeSql();
});

describe("the read API: search and entries by id", () => {
  const app = () => createServerApp();
  // Lazy on purpose: the `describe`'s body is evaluated BEFORE `beforeAll`, so a constant here
  // would carry `Bearer undefined` and everything would answer 401.
  const auth = (): Record<string, string> => ({ authorization: `Bearer ${token}` });

  it("with no session → 401 on all three", async () => {
    const s = createServerApp();
    expect((await s.request(`/search?q=${MARKER}`)).status).toBe(401);
    expect((await s.request(`/entries/${ownId}`)).status).toBe(401);
    expect((await s.request(`/entries/${ownId}`, { method: "PATCH", body: "{}" })).status).toBe(401);
  });

  it("GET /search with no q → 400", async () => {
    expect((await app().request("/search", { headers: auth() })).status).toBe(400);
  });

  it("GET /search with the own project's slug → finds the entry", async () => {
    const res = await app().request(`/search?q=${MARKER}&slug=${own.slug}`, { headers: auth() });
    expect(res.status).toBe(200);
    const { hits } = (await res.json()) as { hits: { id: string }[] };
    expect(hits.map((h) => h.id)).toContain(ownId);
  });

  it("GET /search with a private other project's slug → 403", async () => {
    const res = await app().request(`/search?q=${MARKER}&slug=${other.slug}`, { headers: auth() });
    expect(res.status).toBe(403);
  });

  it("GET /search WITHOUT a slug returns no entries from other people's private projects", async () => {
    const res = await app().request(`/search?q=${MARKER}&limit=50`, { headers: auth() });
    expect(res.status).toBe(200);
    const { hits } = (await res.json()) as { hits: { id: string }[] };
    const ids = hits.map((h) => h.id);
    expect(ids).not.toContain(otherId);
  });

  it("GET /entries/:id — propia 200, ajena 403, inexistente 404", async () => {
    const ok = await app().request(`/entries/${ownId}`, { headers: auth() });
    expect(ok.status).toBe(200);
    expect(((await ok.json()) as { entry: { id: string } }).entry.id).toBe(ownId);

    expect((await app().request(`/entries/${otherId}`, { headers: auth() })).status).toBe(403);
    expect((await app().request("/entries/00000000-0000-0000-0000-000000000000", { headers: auth() })).status).toBe(404);
    // An id that is not a UUID reached Postgres and came back as a 500. It is user input.
    expect((await app().request("/entries/not-a-uuid", { headers: auth() })).status).toBe(404);
  });

  it("PATCH /entries/:id — corrects the title and the content, and the change persists", async () => {
    const headers = { ...auth(), "content-type": "application/json" };
    const res = await app().request(`/entries/${ownId}`, {
      method: "PATCH",
      headers,
      body: JSON.stringify({ title: `Corregida ${MARKER}`, content: `Contenido corregido ${MARKER}.` }),
    });
    expect(res.status).toBe(200);

    const leida = await app().request(`/entries/${ownId}`, { headers: auth() });
    const { entry } = (await leida.json()) as { entry: { title: string; content: string } };
    expect(entry.title).toBe(`Corregida ${MARKER}`);
    expect(entry.content).toContain("Contenido corregido");
  });

  it("PATCH /entries/:id — with no fields → 400; on somebody else's entry → 403", async () => {
    const headers = { ...auth(), "content-type": "application/json" };
    expect((await app().request(`/entries/${ownId}`, { method: "PATCH", headers, body: "{}" })).status).toBe(400);
    expect(
      (await app().request(`/entries/${otherId}`, { method: "PATCH", headers, body: JSON.stringify({ title: "no" }) })).status,
    ).toBe(403);
  });
});

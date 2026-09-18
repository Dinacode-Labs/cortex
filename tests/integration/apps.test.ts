import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import { closeSql } from "@cortex/database";
import {
  createProject,
  listAccessibleProjects,
  listEntries,
  requestOtp,
  verifyOtp,
  saveContext,
  type ProjectRef,
} from "@cortex/core";
import { createApp as createWebApp } from "../../apps/web/src/app.js";
import { createApp as createServerApp } from "../../apps/server/src/app.js";
import { createMcpHttpApp } from "../../apps/mcp-server/src/http-app.js";

/**
 * Smoke tests for the HTTP apps (web, server, mcp-http) through `app.request()`, without
 * standing up servers (step C-1: testable apps). They cover the access GUARDS end to end
 * (401/403/404), which are the real risk; they do not chase coverage.
 */
const RID = Date.now().toString(36);
const USER = `dev-apps-${RID}@example.com`; // NOT an admin (admin@example.com is the env's admin)
const OWNER = `ana-apps-${RID}@example.com`; // owner of the other private project

afterAll(async () => {
  await closeSql();
});

/** In dev mode (with no BREVO_API_KEY) the OTP is logged to stdout; we capture it. */
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
  if (!m) throw new Error("the OTP was not captured (is BREVO_API_KEY set?)");
  return m[1]!;
}

let token: string; // USER's session token (works as a Bearer and as the UI's cookie)
let prvForeign: ProjectRef; // OWNER's private one: USER is not a member
let prvOwn: ProjectRef; // privado de USER

beforeAll(async () => {
  const code = await otpFor(USER);
  ({ token } = await verifyOtp(USER, code));
  prvForeign = await createProject(`IT Apps Prv ${RID}`, { visibility: "private", ownerEmail: OWNER });
  prvOwn = await createProject(`IT Apps Own ${RID}`, { visibility: "private", ownerEmail: USER });
});

describe("HTTP apps (end-to-end guards, with no real server)", () => {
  it("web: with no session cookie → 401", async () => {
    const web = createWebApp();
    const res = await web.request("/");
    expect(res.status).toBe(401);
  });

  it("web: the brand comes from the config, not from the code", async () => {
    const web = createWebApp();
    const html = await (await web.request("/")).text(); // the login screen already carries the branding
    expect(html).toContain("Cortex"); // the default, with no CORTEX_BRAND_NAME
    expect(html).not.toContain("Dinacode"); // the product does not carry the branding of whoever wrote it
  });

  it("web: with a session, a non-existent project → 404", async () => {
    const web = createWebApp();
    const res = await web.request(`/p/does-not-exist-${RID}`, { headers: { cookie: `cortex_session=${token}` } });
    expect(res.status).toBe(404);
  });

  it("web: POST /save to somebody else's private → 403; to your own project → stores with attribution", async () => {
    const web = createWebApp();
    const save = (project: string) =>
      web.request("/save", {
        method: "POST",
        headers: { cookie: `cortex_session=${token}`, "content-type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({ content: `Apps test decision ${RID}.`, project }).toString(),
      });

    const denied = await save(prvForeign.name);
    expect(denied.status).toBe(403);
    expect(await listEntries({ project: prvForeign.name })).toHaveLength(0); // it wrote nothing

    const ok = await save(prvOwn.name);
    expect([200, 302]).toContain(ok.status); // a "Saved" page (200) or a redirect
    const entries = await listEntries({ project: prvOwn.name });
    expect(entries).toHaveLength(1);
    expect(entries[0]!.createdBy).toBe(USER); // attribution: created_by = the session's email
  });

  it("listing with access does not truncate: the filter goes in the query (ADR-0052)", async () => {
    // The real bug: the N most recent entries from ALL projects were requested and the
    // inaccessible ones discarded in memory, so it was enough for the last N to belong to
    // other people to see none of your own. Filtering afterwards does not filter: it truncates.
    const mine = `An entry visible in the listing ${RID}.`;
    await saveContext({ content: mine, project: prvOwn.name, createdBy: USER });

    // ...and now 70 newer entries in a project this user CANNOT see.
    for (let i = 0; i < 70; i++) {
      await saveContext({ content: `Somebody else's noise ${RID} ${i}.`, project: prvForeign.name, createdBy: OWNER });
    }

    const accessible = (await listAccessibleProjects(USER)).map((p) => p.id);
    const seen = await listEntries({ limit: 60, accessibleProjectIds: accessible });
    expect(seen.some((e) => e.content === mine), "your own fell outside the limit").toBe(true);
    expect(seen.some((e) => e.content.includes("Somebody else's noise"))).toBe(false);
  }, 180_000);

  it("server: /context-pack — 401 with no Bearer, 404 for a slug that does not exist, 403 for somebody else's private one", async () => {
    const srv = createServerApp();
    const auth = { authorization: `Bearer ${token}` };

    expect((await srv.request("/context-pack?slug=whatever")).status).toBe(401);
    expect((await srv.request(`/context-pack?slug=does-not-exist-${RID}`, { headers: auth })).status).toBe(404);
    expect((await srv.request(`/context-pack?slug=${prvForeign.slug}`, { headers: auth })).status).toBe(403);
  });

  it("server: POST /auth/request — the same IP cannot request codes unchecked", async () => {
    const { resetRateLimit } = await import("../../apps/server/src/rate-limit.js");
    resetRateLimit();
    vi.stubEnv("CORTEX_AUTH_IP_MAX", "2");
    try {
      const app = createServerApp();
      const ask = (n: number) =>
        app.request("/auth/request", {
          method: "POST",
          headers: { "content-type": "application/json", "x-forwarded-for": "203.0.113.9" },
          body: JSON.stringify({ email: `flood-${n}-${RID}@example.com` }),
        });
      // DIFFERENT addresses: the per-email limit does not stop them, the per-IP one does.
      expect((await ask(1)).status).toBe(200);
      expect((await ask(2)).status).toBe(200);
      expect((await ask(3)).status).toBe(429);

      // Another IP can still get in: the service has not been shut for everyone.
      const other = await app.request("/auth/request", {
        method: "POST",
        headers: { "content-type": "application/json", "x-forwarded-for": "198.51.100.1" },
        body: JSON.stringify({ email: `other-${RID}@example.com` }),
      });
      expect(other.status).toBe(200);
    } finally {
      vi.unstubAllEnvs();
      resetRateLimit();
    }
  });

  it("server: POST /capture — an invalid body → 400 with issues; a valid one → 200 and it persists", async () => {
    const srv = createServerApp();
    const headers = { authorization: `Bearer ${token}`, "content-type": "application/json" };

    // With no slug and a type outside the enum → 400 with readable issues (zod validation).
    const bad = await srv.request("/capture", {
      method: "POST",
      headers,
      body: JSON.stringify({ content: "something", type: "not-a-type" }),
    });
    expect(bad.status).toBe(400);
    const badBody = (await bad.json()) as { error?: string; issues?: { path: string; message: string }[] };
    expect(badBody.error).toBeTruthy();
    expect(badBody.issues?.some((i) => i.path === "slug")).toBe(true);
    expect(badBody.issues?.some((i) => i.path === "type")).toBe(true);

    // A valid body → 200 and the entry exists with attribution (created_by = the Bearer's email).
    const content = `API capture convention ${RID}: bodies are validated with zod.`;
    const ok = await srv.request("/capture", {
      method: "POST",
      headers,
      body: JSON.stringify({ slug: prvOwn.slug, content, type: "convention", confidence: "medium" }),
    });
    expect(ok.status).toBe(200);
    const saved = (await listEntries({ project: prvOwn.name })).find((e) => e.content === content);
    expect(saved).toBeDefined();
    expect(saved!.createdBy).toBe(USER);
  });

  it("server: POST /capture — the server scrubs what it receives (it does not trust the client)", async () => {
    const srv = createServerApp();
    const headers = { authorization: `Bearer ${token}`, "content-type": "application/json" };

    // A client (or a third-party connector) sends secrets unscrubbed: they must not be persisted.
    const marker = `Deployment incident ${RID}`;
    const content = `${marker}: the worker was failing with token sk-abcDEF123456ghiJKL789 against postgres://cortex:s3cr3tP4ss@db.internal/cortex.`;
    const res = await srv.request("/capture", {
      method: "POST",
      headers,
      body: JSON.stringify({ slug: prvOwn.slug, content, type: "incident", confidence: "medium" }),
    });
    expect(res.status).toBe(200);

    const saved = (await listEntries({ project: prvOwn.name })).find((e) => e.content.includes(marker));
    expect(saved).toBeDefined();
    expect(saved!.content).not.toContain("sk-abcDEF123456ghiJKL789");
    expect(saved!.content).not.toContain("s3cr3tP4ss");
    expect(saved!.content).toContain("[REDACTED]");
    expect(saved!.content).toContain("db.internal"); // the useful context survives
  });

  it("web: real autoescaping — content with a <script> shows up escaped at /entry/:id", async () => {
    const web = createWebApp();
    // Malicious content: if hono/html's auto-escaping did not work, this would be XSS.
    const payload = `Security constraint ${RID}: the content <script>alert(1)</script> must show up escaped.`;
    const saved = await web.request("/save", {
      method: "POST",
      headers: { cookie: `cortex_session=${token}`, "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ content: payload, project: prvOwn.name }).toString(),
    });
    expect([200, 302]).toContain(saved.status);

    const entry = (await listEntries({ project: prvOwn.name })).find((e) => e.content.includes("<script>"));
    expect(entry).toBeDefined();

    const page = await web.request(`/entry/${entry!.id}`, { headers: { cookie: `cortex_session=${token}` } });
    expect(page.status).toBe(200);
    const bodyHtml = await page.text();
    expect(bodyHtml).toContain("&lt;script&gt;");
    expect(bodyHtml).not.toContain("<script>alert");

    // The same content goes through entryCard (the dashboard) and through the search view:
    // it covers the sinks of the whole render tree, not just the detail page.
    const dash = await web.request(`/p/${prvOwn.slug}`, { headers: { cookie: `cortex_session=${token}` } });
    expect(dash.status).toBe(200);
    expect(await dash.text()).not.toContain("<script>alert");
    const search = await web.request(`/search?q=${encodeURIComponent(`Security constraint ${RID}`)}&project=${encodeURIComponent(prvOwn.name)}`, { headers: { cookie: `cortex_session=${token}` } });
    expect(search.status).toBe(200);
    expect(await search.text()).not.toContain("<script>alert");
  });

  it("web: GET /search with no project does NOT leak entries from somebody else's private ones (P0)", async () => {
    // P0 leak (backlog #1): the web, with a session but no project, must not return content
    // from other people's private projects. We seed an entry in OWNER's private project
    // (prvForeign) and search as USER (not a member): its title must not appear.
    // TWO tokens are used: `queryTok` goes in the content (it triggers the search) and comes
    // back in the <h1> "Results for ..."; `secretTok` is ONLY in the title → if it shows up in
    // the body, the private entry leaked (rather than the query being echoed).
    const web = createWebApp();
    const queryTok = `websearchable${RID}`;
    const secretTok = `WEBSECRETTITLE${RID}`;
    await saveContext({
      content: `Restricted content ${queryTok}.`,
      project: prvForeign.name,
      type: "constraint",
      title: `Constraint ${secretTok}`,
    });

    const res = await web.request(`/search?q=${encodeURIComponent(queryTok)}`, {
      headers: { cookie: `cortex_session=${token}` },
    });
    expect(res.status).toBe(200);
    const bodyHtml = await res.text();
    expect(bodyHtml).not.toContain(secretTok); // the other private project's title does NOT leak
  });


  it("server: GET /client-config is public and brings what the CLI needs to start", async () => {
    const srv = createServerApp();
    const res = await srv.request("/client-config"); // deliberately with no Bearer
    expect(res.status).toBe(200);
    const cfg = (await res.json()) as Record<string, string>;
    // The CLI leans on these five: without `mcpUrl` it would have to guess the MCP's port.
    for (const k of ["apiUrl", "mcpUrl", "webUrl", "version", "minClientVersion"]) {
      expect(typeof cfg[k]).toBe("string");
      expect(cfg[k]).not.toBe("");
    }
  });

  it("server: GET /projects/:slug — 401, 404 and 403 with the list of admins", async () => {
    const srv = createServerApp();
    const auth = { authorization: `Bearer ${token}` };

    expect((await srv.request(`/projects/${prvOwn.slug}`)).status).toBe(401);
    expect((await srv.request(`/projects/does-not-exist-${RID}`, { headers: auth })).status).toBe(404);

    // Somebody else's private one: 403 and, with it, whom to ask for access (what `cortex link` shows).
    const forbidden = await srv.request(`/projects/${prvForeign.slug}`, { headers: auth });
    expect(forbidden.status).toBe(403);
    expect((await forbidden.json()) as { admins?: string[] }).toHaveProperty("admins");

    const ok = await srv.request(`/projects/${prvOwn.slug}`, { headers: auth });
    expect(ok.status).toBe(200);
    const { project } = (await ok.json()) as { project: { slug: string; visibility: string } };
    expect(project.slug).toBe(prvOwn.slug);
    expect(project.visibility).toBe("private");
  });

  it("server: POST /projects creates, and repeating it does NOT duplicate (the slug is the identity)", async () => {
    const srv = createServerApp();
    const headers = { authorization: `Bearer ${token}`, "content-type": "application/json" };
    const name = `IT API Project ${RID}`;

    const created = await srv.request("/projects", { method: "POST", headers, body: JSON.stringify({ name }) });
    expect(created.status).toBe(201);
    const first = (await created.json()) as { project: { slug: string }; created: boolean };
    expect(first.created).toBe(true);

    // Second time: it links you to the existing one rather than inventing a slug-2, which
    // would split the same project's memory in two.
    const again = await srv.request("/projects", { method: "POST", headers, body: JSON.stringify({ name }) });
    expect(again.status).toBe(200);
    const second = (await again.json()) as { project: { slug: string }; created: boolean };
    expect(second.created).toBe(false);
    expect(second.project.slug).toBe(first.project.slug);
  });

  it("server: POST /projects — a parent that does not exist is 400, not 500", async () => {
    const srv = createServerApp();
    const res = await srv.request("/projects", {
      method: "POST",
      headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
      body: JSON.stringify({ name: `IT Orphan ${RID}`, parentSlug: `does-not-exist-${RID}` }),
    });
    expect(res.status).toBe(400); // the client's fault, and the reason goes in the body
    expect((await res.json()) as { error?: string }).toHaveProperty("error");
  });

  it("server: POST /projects to somebody else's private one → 403 leaking nothing else", async () => {
    const srv = createServerApp();
    const res = await srv.request("/projects", {
      method: "POST",
      headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
      body: JSON.stringify({ name: prvForeign.name }),
    });
    expect(res.status).toBe(403);
  });

  it("mcp http: POST /mcp with no Bearer → 401 (auth on by default)", async () => {
    const mcp = createMcpHttpApp();
    const res = await mcp.request("/mcp", {
      method: "POST",
      headers: { "content-type": "application/json", accept: "application/json, text/event-stream" },
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "initialize", params: { protocolVersion: "2025-03-26", capabilities: {}, clientInfo: { name: "test", version: "0" } } }),
    });
    expect(res.status).toBe(401);
    const body = (await res.json()) as { error?: { code?: number } };
    expect(body.error?.code).toBe(-32001);
  });
});

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { closeSql } from "@cortex/database";
import { createProject, listEntries, requestOtp, verifyOtp, saveContext, type ProjectRef } from "@cortex/core";
import { createApp as createWebApp } from "../../apps/web/src/app.js";
import { createApp as createServerApp } from "../../apps/server/src/app.js";
import { createMcpHttpApp } from "../../apps/mcp-server/src/http-app.js";

/**
 * Smoke tests de las apps HTTP (web, server, mcp-http) vía `app.request()`, sin
 * levantar servidores (paso C-1: apps testeables). Cubren los GUARDS de acceso
 * end-to-end (401/403/404), que son el riesgo real; no persiguen cobertura.
 */
const RID = Date.now().toString(36);
const USER = `dev-apps-${RID}@dinacode.com`; // NO admin (admin@dinacode.com es el admin del env)
const OWNER = `ana-apps-${RID}@dinacode.com`; // dueña del proyecto privado ajeno

afterAll(async () => {
  await closeSql();
});

/** En modo dev (sin BREVO_API_KEY) el OTP se loguea por stdout; lo capturamos. */
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
  if (!m) throw new Error("no se capturó el OTP (¿BREVO_API_KEY activo?)");
  return m[1]!;
}

let token: string; // token de sesión de USER (vale como Bearer y como cookie de la UI)
let prvForeign: ProjectRef; // privado de OWNER: USER no es miembro
let prvOwn: ProjectRef; // privado de USER

beforeAll(async () => {
  const code = await otpFor(USER);
  ({ token } = await verifyOtp(USER, code));
  prvForeign = await createProject(`IT Apps Prv ${RID}`, { visibility: "private", ownerEmail: OWNER });
  prvOwn = await createProject(`IT Apps Own ${RID}`, { visibility: "private", ownerEmail: USER });
});

describe("apps HTTP (guards end-to-end, sin servidor real)", () => {
  it("web: sin cookie de sesión → 401", async () => {
    const web = createWebApp();
    const res = await web.request("/");
    expect(res.status).toBe(401);
  });

  it("web: con sesión, proyecto inexistente → 404", async () => {
    const web = createWebApp();
    const res = await web.request(`/?project=${encodeURIComponent(`NoExiste${RID}`)}`, {
      headers: { cookie: `cortex_session=${token}` },
    });
    expect(res.status).toBe(404);
  });

  it("web: POST /save a privado ajeno → 403; a proyecto propio → guarda con atribución", async () => {
    const web = createWebApp();
    const save = (project: string) =>
      web.request("/save", {
        method: "POST",
        headers: { cookie: `cortex_session=${token}`, "content-type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({ content: `Decisión de prueba apps ${RID}.`, project }).toString(),
      });

    const denied = await save(prvForeign.name);
    expect(denied.status).toBe(403);
    expect(await listEntries({ project: prvForeign.name })).toHaveLength(0); // no escribió nada

    const ok = await save(prvOwn.name);
    expect([200, 302]).toContain(ok.status); // página "Guardado" (200) o redirect
    const entries = await listEntries({ project: prvOwn.name });
    expect(entries).toHaveLength(1);
    expect(entries[0]!.createdBy).toBe(USER); // atribución: created_by = email de la sesión
  });

  it("server: /context-pack — 401 sin Bearer, 404 slug inexistente, 403 privado ajeno", async () => {
    const srv = createServerApp();
    const auth = { authorization: `Bearer ${token}` };

    expect((await srv.request("/context-pack?slug=lo-que-sea")).status).toBe(401);
    expect((await srv.request(`/context-pack?slug=no-existe-${RID}`, { headers: auth })).status).toBe(404);
    expect((await srv.request(`/context-pack?slug=${prvForeign.slug}`, { headers: auth })).status).toBe(403);
  });

  it("server: POST /capture — body inválido → 400 con issues; body válido → 200 y persiste", async () => {
    const srv = createServerApp();
    const headers = { authorization: `Bearer ${token}`, "content-type": "application/json" };

    // Sin slug y con type fuera del enum → 400 con issues legibles (validación zod).
    const bad = await srv.request("/capture", {
      method: "POST",
      headers,
      body: JSON.stringify({ content: "algo", type: "no-es-un-tipo" }),
    });
    expect(bad.status).toBe(400);
    const badBody = (await bad.json()) as { error?: string; issues?: { path: string; message: string }[] };
    expect(badBody.error).toBeTruthy();
    expect(badBody.issues?.some((i) => i.path === "slug")).toBe(true);
    expect(badBody.issues?.some((i) => i.path === "type")).toBe(true);

    // Body válido → 200 y la entrada existe con atribución (created_by = email del Bearer).
    const content = `Convención de captura por API ${RID}: los bodies se validan con zod.`;
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

  it("web: autoescape real — contenido con <script> se muestra escapado en /entry/:id", async () => {
    const web = createWebApp();
    // Contenido malicioso: si el autoescape de hono/html no funcionara, esto sería XSS.
    const payload = `Restricción de seguridad ${RID}: el contenido <script>alert(1)</script> debe verse escapado.`;
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

    // El mismo contenido pasa por entryCard (dashboard) y por la vista de búsqueda:
    // cubre los sinks del árbol de vistas, no solo el detalle.
    const dash = await web.request(`/?project=${encodeURIComponent(prvOwn.name)}`, { headers: { cookie: `cortex_session=${token}` } });
    expect(dash.status).toBe(200);
    expect(await dash.text()).not.toContain("<script>alert");
    const search = await web.request(`/search?q=${encodeURIComponent(`Restricción de seguridad ${RID}`)}&project=${encodeURIComponent(prvOwn.name)}`, { headers: { cookie: `cortex_session=${token}` } });
    expect(search.status).toBe(200);
    expect(await search.text()).not.toContain("<script>alert");
  });

  it("web: GET /search sin proyecto NO filtra entradas de privados ajenos (P0)", async () => {
    // Fuga P0 (backlog #1): la web con sesión pero sin proyecto no puede devolver
    // contenido de proyectos privados ajenos. Sembramos una entrada en el privado de
    // OWNER (prvForeign) y buscamos como USER (no miembro): su título no debe aparecer.
    // Usamos DOS tokens: `queryTok` va en el contenido (dispara la búsqueda) y se
    // devuelve en el <h1> "Resultados para ..."; `secretTok` SOLO en el título → si
    // aparece en el body, es que se filtró la entrada privada (no el eco de la query).
    const web = createWebApp();
    const queryTok = `webbuscable${RID}`;
    const secretTok = `WEBTITULOSECRETO${RID}`;
    await saveContext({
      content: `Contenido reservado ${queryTok}.`,
      project: prvForeign.name,
      type: "constraint",
      title: `Restricción ${secretTok}`,
    });

    const res = await web.request(`/search?q=${encodeURIComponent(queryTok)}`, {
      headers: { cookie: `cortex_session=${token}` },
    });
    expect(res.status).toBe(200);
    const bodyHtml = await res.text();
    expect(bodyHtml).not.toContain(secretTok); // el título del privado ajeno NO se filtra
  });

  it("mcp http: POST /mcp sin Bearer → 401 (auth on por defecto)", async () => {
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

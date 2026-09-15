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
 * Smoke tests de las apps HTTP (web, server, mcp-http) vía `app.request()`, sin
 * levantar servidores (paso C-1: apps testeables). Cubren los GUARDS de acceso
 * end-to-end (401/403/404), que son el riesgo real; no persiguen cobertura.
 */
const RID = Date.now().toString(36);
const USER = `dev-apps-${RID}@example.com`; // NO admin (admin@example.com es el admin del env)
const OWNER = `ana-apps-${RID}@example.com`; // dueña del proyecto privado ajeno

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

  it("web: la marca sale de la config, no del código", async () => {
    const web = createWebApp();
    const html = await (await web.request("/")).text(); // la pantalla de login ya lleva marca
    expect(html).toContain("Cortex"); // default, sin CORTEX_BRAND_NAME
    expect(html).not.toContain("Dinacode"); // el producto no lleva la marca de quien lo escribió
  });

  it("web: con sesión, proyecto inexistente → 404", async () => {
    const web = createWebApp();
    const res = await web.request(`/p/no-existe-${RID}`, { headers: { cookie: `cortex_session=${token}` } });
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

  it("listar con acceso no recorta: el filtro va en la consulta (ADR-0052)", async () => {
    // El fallo real: se pedían las N entradas más recientes de TODOS los proyectos y se
    // descartaban en memoria las inaccesibles, así que bastaba con que las últimas N fueran
    // ajenas para no ver ninguna de las propias. Filtrar después no filtra: recorta.
    const mia = `Entrada visible del listado ${RID}.`;
    await saveContext({ content: mia, project: prvOwn.name, createdBy: USER });

    // …y ahora 70 entradas más nuevas en un proyecto que este usuario NO puede ver.
    for (let i = 0; i < 70; i++) {
      await saveContext({ content: `Ruido ajeno ${RID} ${i}.`, project: prvForeign.name, createdBy: OWNER });
    }

    const accesibles = (await listAccessibleProjects(USER)).map((p) => p.id);
    const vistas = await listEntries({ limit: 60, accessibleProjectIds: accesibles });
    expect(vistas.some((e) => e.content === mia), "la propia se quedó fuera del límite").toBe(true);
    expect(vistas.some((e) => e.content.includes("Ruido ajeno"))).toBe(false);
  }, 180_000);

  it("server: /context-pack — 401 sin Bearer, 404 slug inexistente, 403 privado ajeno", async () => {
    const srv = createServerApp();
    const auth = { authorization: `Bearer ${token}` };

    expect((await srv.request("/context-pack?slug=lo-que-sea")).status).toBe(401);
    expect((await srv.request(`/context-pack?slug=no-existe-${RID}`, { headers: auth })).status).toBe(404);
    expect((await srv.request(`/context-pack?slug=${prvForeign.slug}`, { headers: auth })).status).toBe(403);
  });

  it("server: POST /auth/request — la misma IP no puede pedir códigos sin freno", async () => {
    const { reiniciaLimite } = await import("../../apps/server/src/rate-limit.js");
    reiniciaLimite();
    vi.stubEnv("CORTEX_AUTH_IP_MAX", "2");
    try {
      const app = createServerApp();
      const pide = (n: number) =>
        app.request("/auth/request", {
          method: "POST",
          headers: { "content-type": "application/json", "x-forwarded-for": "203.0.113.9" },
          body: JSON.stringify({ email: `flood-${n}-${RID}@example.com` }),
        });
      // Direcciones DISTINTAS: el límite por email no las frena, el de IP sí.
      expect((await pide(1)).status).toBe(200);
      expect((await pide(2)).status).toBe(200);
      expect((await pide(3)).status).toBe(429);

      // Otra IP sigue pudiendo entrar: no se ha cerrado el servicio para todos.
      const otra = await app.request("/auth/request", {
        method: "POST",
        headers: { "content-type": "application/json", "x-forwarded-for": "198.51.100.1" },
        body: JSON.stringify({ email: `otra-${RID}@example.com` }),
      });
      expect(otra.status).toBe(200);
    } finally {
      vi.unstubAllEnvs();
      reiniciaLimite();
    }
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

  it("server: POST /capture — el servidor escruba lo que recibe (no confía en el cliente)", async () => {
    const srv = createServerApp();
    const headers = { authorization: `Bearer ${token}`, "content-type": "application/json" };

    // Un cliente (o un conector de terceros) manda secretos sin limpiar: no deben persistirse.
    const marker = `Incidencia de despliegue ${RID}`;
    const content = `${marker}: el worker fallaba con token sk-abcDEF123456ghiJKL789 contra postgres://cortex:s3cr3tP4ss@db.internal/cortex.`;
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
    expect(saved!.content).toContain("db.internal"); // el contexto útil sobrevive
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
    const dash = await web.request(`/p/${prvOwn.slug}`, { headers: { cookie: `cortex_session=${token}` } });
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


  it("server: GET /client-config es público y trae lo que el CLI necesita para arrancar", async () => {
    const srv = createServerApp();
    const res = await srv.request("/client-config"); // sin Bearer a propósito
    expect(res.status).toBe(200);
    const cfg = (await res.json()) as Record<string, string>;
    // El CLI se apoya en estas cinco: sin `mcpUrl` tendría que adivinar el puerto del MCP.
    for (const k of ["apiUrl", "mcpUrl", "webUrl", "version", "minClientVersion"]) {
      expect(typeof cfg[k]).toBe("string");
      expect(cfg[k]).not.toBe("");
    }
  });

  it("server: GET /projects/:slug — 401, 404 y 403 con la lista de admins", async () => {
    const srv = createServerApp();
    const auth = { authorization: `Bearer ${token}` };

    expect((await srv.request(`/projects/${prvOwn.slug}`)).status).toBe(401);
    expect((await srv.request(`/projects/no-existe-${RID}`, { headers: auth })).status).toBe(404);

    // Privado ajeno: 403 y, con él, a quién pedir acceso (es lo que enseña `cortex link`).
    const forbidden = await srv.request(`/projects/${prvForeign.slug}`, { headers: auth });
    expect(forbidden.status).toBe(403);
    expect((await forbidden.json()) as { admins?: string[] }).toHaveProperty("admins");

    const ok = await srv.request(`/projects/${prvOwn.slug}`, { headers: auth });
    expect(ok.status).toBe(200);
    const { project } = (await ok.json()) as { project: { slug: string; visibility: string } };
    expect(project.slug).toBe(prvOwn.slug);
    expect(project.visibility).toBe("private");
  });

  it("server: POST /projects crea, y repetirlo NO duplica (el slug es la identidad)", async () => {
    const srv = createServerApp();
    const headers = { authorization: `Bearer ${token}`, "content-type": "application/json" };
    const name = `IT Proyecto API ${RID}`;

    const created = await srv.request("/projects", { method: "POST", headers, body: JSON.stringify({ name }) });
    expect(created.status).toBe(201);
    const first = (await created.json()) as { project: { slug: string }; created: boolean };
    expect(first.created).toBe(true);

    // Segunda vez: te vincula al existente en vez de inventar un slug-2, que partiría en
    // dos la memoria del mismo proyecto.
    const again = await srv.request("/projects", { method: "POST", headers, body: JSON.stringify({ name }) });
    expect(again.status).toBe(200);
    const second = (await again.json()) as { project: { slug: string }; created: boolean };
    expect(second.created).toBe(false);
    expect(second.project.slug).toBe(first.project.slug);
  });

  it("server: POST /projects — un padre inexistente es 400, no 500", async () => {
    const srv = createServerApp();
    const res = await srv.request("/projects", {
      method: "POST",
      headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
      body: JSON.stringify({ name: `IT Huérfano ${RID}`, parentSlug: `no-existe-${RID}` }),
    });
    expect(res.status).toBe(400); // culpa del cliente, y el motivo va en el cuerpo
    expect((await res.json()) as { error?: string }).toHaveProperty("error");
  });

  it("server: POST /projects a un privado ajeno → 403 sin filtrar nada más", async () => {
    const srv = createServerApp();
    const res = await srv.request("/projects", {
      method: "POST",
      headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
      body: JSON.stringify({ name: prvForeign.name }),
    });
    expect(res.status).toBe(403);
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

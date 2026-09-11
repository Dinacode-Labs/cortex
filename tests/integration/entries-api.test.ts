import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { closeSql } from "@cortex/database";
import { createProject, requestOtp, saveContext, verifyOtp, type ProjectRef } from "@cortex/core";
import { createApp as createServerApp } from "../../apps/server/src/app.js";

/**
 * `GET /search`, `GET /entries/:id` y `PATCH /entries/:id` (ADR-0034).
 *
 * Lo que se prueba aquí son los GUARDS, que es el riesgo real: hasta ahora la API solo sabía
 * escribir, y abrir la lectura es justo donde se filtra el proyecto privado de otro. La
 * búsqueda sin `slug` es la más delicada, porque recorre varios proyectos a la vez.
 */
const RID = Date.now().toString(36);
const USER = `dev-entries-${RID}@example.com`;
const OWNER = `ana-entries-${RID}@example.com`;
const MARCA = `zxqmarca${RID}`; // palabra rara: aparece en las dos entradas y no en nada más

let token: string;
let ajeno: ProjectRef; // privado de OWNER
let propio: ProjectRef; // privado de USER
let idPropia: string;
let idAjena: string;

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
  if (!m) throw new Error("no se capturó el OTP");
  return m[1]!;
}

beforeAll(async () => {
  ({ token } = await verifyOtp(USER, await otpFor(USER)));
  ajeno = await createProject(`IT Entries Prv ${RID}`, { visibility: "private", ownerEmail: OWNER });
  propio = await createProject(`IT Entries Own ${RID}`, { visibility: "private", ownerEmail: USER });

  const a = await saveContext(
    { content: `Decisión ${MARCA}: los hooks cierran stdin antes de esperar.`, project: propio.name, title: `Propia ${MARCA}`, type: "decision", createdBy: USER },
    { useClassifier: false },
  );
  idPropia = a.entry.id;
  const b = await saveContext(
    { content: `Decisión ${MARCA}: esto es del proyecto de otra persona.`, project: ajeno.name, title: `Ajena ${MARCA}`, type: "decision", createdBy: OWNER },
    { useClassifier: false },
  );
  idAjena = b.entry.id;
});

afterAll(async () => {
  await closeSql();
});

describe("API de lectura: búsqueda y entradas por id", () => {
  const app = () => createServerApp();
  // Perezoso a propósito: el cuerpo del `describe` se evalúa ANTES del `beforeAll`, así que
  // una constante aquí llevaría `Bearer undefined` y todo respondería 401.
  const auth = (): Record<string, string> => ({ authorization: `Bearer ${token}` });

  it("sin sesión → 401 en los tres", async () => {
    const s = createServerApp();
    expect((await s.request(`/search?q=${MARCA}`)).status).toBe(401);
    expect((await s.request(`/entries/${idPropia}`)).status).toBe(401);
    expect((await s.request(`/entries/${idPropia}`, { method: "PATCH", body: "{}" })).status).toBe(401);
  });

  it("GET /search sin q → 400", async () => {
    expect((await app().request("/search", { headers: auth() })).status).toBe(400);
  });

  it("GET /search con slug del proyecto propio → encuentra la entrada", async () => {
    const res = await app().request(`/search?q=${MARCA}&slug=${propio.slug}`, { headers: auth() });
    expect(res.status).toBe(200);
    const { hits } = (await res.json()) as { hits: { id: string }[] };
    expect(hits.map((h) => h.id)).toContain(idPropia);
  });

  it("GET /search con el slug de un privado ajeno → 403", async () => {
    const res = await app().request(`/search?q=${MARCA}&slug=${ajeno.slug}`, { headers: auth() });
    expect(res.status).toBe(403);
  });

  it("GET /search SIN slug no devuelve entradas de proyectos privados ajenos", async () => {
    const res = await app().request(`/search?q=${MARCA}&limit=50`, { headers: auth() });
    expect(res.status).toBe(200);
    const { hits } = (await res.json()) as { hits: { id: string }[] };
    const ids = hits.map((h) => h.id);
    expect(ids).not.toContain(idAjena); // lo que importa
  });

  it("GET /entries/:id — propia 200, ajena 403, inexistente 404", async () => {
    const ok = await app().request(`/entries/${idPropia}`, { headers: auth() });
    expect(ok.status).toBe(200);
    expect(((await ok.json()) as { entry: { id: string } }).entry.id).toBe(idPropia);

    expect((await app().request(`/entries/${idAjena}`, { headers: auth() })).status).toBe(403);
    expect((await app().request("/entries/00000000-0000-0000-0000-000000000000", { headers: auth() })).status).toBe(404);
    // Un id que no es un UUID llegaba a Postgres y salía un 500. Es entrada de usuario.
    expect((await app().request("/entries/no-soy-un-uuid", { headers: auth() })).status).toBe(404);
  });

  it("PATCH /entries/:id — corrige el título y el contenido, y el cambio persiste", async () => {
    const headers = { ...auth(), "content-type": "application/json" };
    const res = await app().request(`/entries/${idPropia}`, {
      method: "PATCH",
      headers,
      body: JSON.stringify({ title: `Corregida ${MARCA}`, content: `Contenido corregido ${MARCA}.` }),
    });
    expect(res.status).toBe(200);

    const leida = await app().request(`/entries/${idPropia}`, { headers: auth() });
    const { entry } = (await leida.json()) as { entry: { title: string; content: string } };
    expect(entry.title).toBe(`Corregida ${MARCA}`);
    expect(entry.content).toContain("Contenido corregido");
  });

  it("PATCH /entries/:id — sin campos → 400; sobre una entrada ajena → 403", async () => {
    const headers = { ...auth(), "content-type": "application/json" };
    expect((await app().request(`/entries/${idPropia}`, { method: "PATCH", headers, body: "{}" })).status).toBe(400);
    expect(
      (await app().request(`/entries/${idAjena}`, { method: "PATCH", headers, body: JSON.stringify({ title: "no" }) })).status,
    ).toBe(403);
  });
});

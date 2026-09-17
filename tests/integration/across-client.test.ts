import { describe, it, expect, beforeAll } from "vitest";
import { getSql } from "@cortex/database";
import {
  createProject,
  getAcrossClient,
  linkEntryToEntity,
  relateEntries,
  requestOtp,
  resolveEntity,
  saveContext,
  verifyOtp,
  type ProjectRef,
} from "@cortex/core";
import { createApp as createWebApp } from "../../apps/web/src/app.js";

/**
 * «Across this client»: lo que solo se ve mirando a un cliente entero (ADR-0063).
 *
 * La herencia del producto SUBE —un repo lee lo del cliente, nunca lo de un hermano—, así que
 * qué comparten los repos y dónde se contradicen entre ellos no lo miraba nadie: `lintProject`
 * es por proyecto y el pack de cada hijo solo ve su rama. Bajar es deliberado, se hace desde
 * el padre y filtra por permisos en cada paso, que es lo que más se protege aquí.
 */
const RID = Math.random().toString(36).slice(2, 8);
const USER = `across-${RID}@example.com`; // ve el cliente y los dos hijos públicos
const DUENO = `dueno-${RID}@example.com`; // dueño de todo, incluido el hijo privado

async function otpDe(email: string): Promise<string> {
  let cap = "";
  const orig = console.log;
  console.log = ((...a: unknown[]) => {
    cap += a.join(" ") + "\n";
  }) as typeof console.log;
  try {
    await requestOtp(email);
  } finally {
    console.log = orig;
  }
  const linea = cap.split("\n").find((l) => l.includes(email));
  const m = linea?.match(/(\d{6})/);
  if (!m) throw new Error(`no se capturo el OTP de ${email}`);
  return m[1]!;
}

let cookie: string;
let cliente: ProjectRef;
let repoA: ProjectRef;
let repoB: ProjectRef;
let repoPrivado: ProjectRef;
let suelto: ProjectRef;
let entradaA: string;
let entradaB: string;

/** Guarda una entrada y la cuelga de una entidad, como haría el extractor. */
async function guardaCon(project: string, contenido: string, entidad: [string, "technology" | "client"]): Promise<string> {
  const { entry } = await saveContext({ content: contenido, project, type: "decision", createdBy: DUENO });
  const e = await resolveEntity(getSql(), entidad[0], entidad[1]);
  await linkEntryToEntity(getSql(), entry.id, e.id);
  return entry.id;
}

beforeAll(async () => {
  const { token } = await verifyOtp(USER, await otpDe(USER));
  cookie = `cortex_session=${token}`;

  cliente = await createProject(`Across ${RID}`, { ownerEmail: DUENO });
  repoA = await createProject(`Across API ${RID}`, { ownerEmail: DUENO, parentSlug: cliente.slug! });
  repoB = await createProject(`Across Web ${RID}`, { ownerEmail: DUENO, parentSlug: cliente.slug! });
  repoPrivado = await createProject(`Across Secreto ${RID}`, {
    ownerEmail: DUENO,
    visibility: "private",
    parentSlug: cliente.slug!,
  });
  suelto = await createProject(`Across Suelto ${RID}`, { ownerEmail: DUENO });

  // Compartido de verdad entre los dos repos públicos.
  entradaA = await guardaCon(repoA.name, `La API ${RID} se despliega en contenedores.`, [`Kubernetes${RID}`, "technology"]);
  entradaB = await guardaCon(repoB.name, `La web ${RID} se sirve desde el mismo clúster.`, [`Kubernetes${RID}`, "technology"]);
  // Ruido del extractor: el nombre del cliente como entidad `client` en los dos repos. Es el
  // caso de #135 y no puede salir como «tecnología compartida».
  await guardaCon(repoA.name, `El cliente ${RID} revisa los despliegues.`, [`Cliente${RID}`, "client"]);
  await guardaCon(repoB.name, `El cliente ${RID} pide informes mensuales.`, [`Cliente${RID}`, "client"]);
  // Compartido con el repo PRIVADO: para quien no es miembro, esto no existe.
  await guardaCon(repoA.name, `La API ${RID} guarda sesiones en memoria.`, [`Redis${RID}`, "technology"]);
  await guardaCon(repoPrivado.name, `El secreto ${RID} también las guarda ahí.`, [`Redis${RID}`, "technology"]);

  // Un choque ENTRE HERMANOS: es justo lo que ningún lint veía.
  await relateEntries(entradaA, entradaB, "contradicts");
}, 240_000);

const get = (ruta: string) => createWebApp().request(ruta, { headers: { cookie } });

describe("la vista de cliente (core)", () => {
  it("el stack compartido son entidades de dos o más hijos, sin el ruido de client/project/repository", async () => {
    const { sharedStack } = await getAcrossClient(cliente, USER);
    const nombres = sharedStack.map((e) => e.name);
    expect(nombres).toContain(`Kubernetes${RID}`);
    // El nombre del cliente está colgado de los dos repos, así que un cruce ingenuo lo sacaría
    // como lo más compartido de todos. Es ruido del extractor (#135), no stack.
    expect(nombres).not.toContain(`Cliente${RID}`);

    const k = sharedStack.find((e) => e.name === `Kubernetes${RID}`)!;
    expect(k.projects.map((p) => p.name).sort()).toEqual([repoA.name, repoB.name].sort());
  }, 120_000);

  it("un hijo privado no aporta al cruce de quien no puede verlo", async () => {
    const deFuera = await getAcrossClient(cliente, USER);
    // `Redis` solo aparece en el repo público A y en el privado: sin acceso al privado es una
    // sola procedencia, así que no es «compartido» y no puede asomar ni por el nombre.
    expect(deFuera.sharedStack.map((e) => e.name)).not.toContain(`Redis${RID}`);
    expect(deFuera.children.map((c) => c.id)).not.toContain(repoPrivado.id);

    const delDueno = await getAcrossClient(cliente, DUENO);
    expect(delDueno.sharedStack.map((e) => e.name)).toContain(`Redis${RID}`);
  }, 120_000);

  it("las contradicciones que cruzan proyectos, que ningún lint por proyecto ve", async () => {
    const { contradictions } = await getAcrossClient(cliente, USER);
    const par = contradictions.find((x) => [x.a.id, x.b.id].includes(entradaA));
    expect(par, "el choque entre los dos repos debe aparecer").toBeTruthy();
    expect([par!.a.project.name, par!.b.project.name].sort()).toEqual([repoA.name, repoB.name].sort());
  }, 120_000);

  it("un proyecto sin hijos no tiene vista transversal que enseñar", async () => {
    const vacia = await getAcrossClient(suelto, USER);
    expect(vacia).toEqual({ children: [], sharedStack: [], contradictions: [] });
  }, 60_000);
});

describe("la vista de cliente (web)", () => {
  it("la pestaña sale en el cliente y no en un proyecto suelto", async () => {
    const cli = await (await get(`/p/${cliente.slug}`)).text();
    expect(cli).toContain(`/p/${cliente.slug}/across`);
    const sol = await (await get(`/p/${suelto.slug}`)).text();
    expect(sol).not.toContain(`/p/${suelto.slug}/across`);
    expect(sol).not.toContain("Across this client");
  }, 60_000);

  it("la sección enseña el stack compartido y el choque, enlazados", async () => {
    const html = await (await get(`/p/${cliente.slug}/across`)).text();
    expect(html).toContain(`Kubernetes${RID}`);
    expect(html).not.toContain(`Cliente${RID}`);
    expect(html).toContain(`href="/p/${repoA.slug}"`);
    expect(html).toContain(`href="/entry/${entradaA}"`);
    expect(html).toContain(`href="/entry/${entradaB}"`);
  }, 60_000);

  it("sin hijos no hay sección, aunque se escriba la URL", async () => {
    expect((await get(`/p/${suelto.slug}/across`)).status).toBe(404);
  }, 60_000);

  it("buscar desde el padre puede bajar a los hijos, y solo si se pide", async () => {
    const url = (extra: string) =>
      `/search?q=${encodeURIComponent(`clúster ${RID}`)}&project=${encodeURIComponent(cliente.name)}${extra}`;
    const soloPadre = await (await get(url(""))).text();
    expect(soloPadre).not.toContain(`/entry/${entradaB}`);

    const conHijos = await (await get(url("&children=1"))).text();
    expect(conHijos).toContain(`/entry/${entradaB}`);
    // Y se dice de qué repo es cada resultado: si no, los de tres repos se leen como uno.
    expect(conHijos).toContain(repoB.name);
  }, 120_000);

  it("bajar desde el padre no abre el hijo privado", async () => {
    const html = await (
      await get(`/search?q=${encodeURIComponent(`secreto ${RID}`)}&project=${encodeURIComponent(cliente.name)}&children=1`)
    ).text();
    expect(html).not.toContain(`El secreto ${RID}`);
    expect(html).not.toContain(repoPrivado.name);
  }, 120_000);

  it("las clases de la vista de cliente están estiladas", async () => {
    const { readFileSync } = await import("node:fs");
    const { resolve } = await import("node:path");
    const css = readFileSync(resolve(import.meta.dirname, "../../apps/web/public/styles.css"), "utf8");
    const html = await (await get(`/p/${cliente.slug}/across`)).text();
    const clases = new Set([...html.matchAll(/class="([^"]+)"/g)].flatMap((m) => m[1]!.split(/\s+/).filter(Boolean)));
    expect([...clases].filter((c) => !css.includes(`.${c}`))).toEqual([]);
  }, 60_000);
});

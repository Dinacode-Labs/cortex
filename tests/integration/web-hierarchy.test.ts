import { describe, it, expect, beforeAll } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { createProject, requestOtp, saveContext, verifyOtp, type ProjectRef } from "@cortex/core";
import { createApp as createWebApp } from "../../apps/web/src/app.js";

/**
 * Navegar la jerarquía: de un repo a su cliente y del cliente a sus repos.
 *
 * Un cliente con varios repositorios se modela como proyecto padre + un hijo por repo
 * (ADR-0037, ADR-0056), y de esa relación cuelgan la herencia del context pack y los permisos.
 * Hasta ahora no se veía en ninguna pantalla: los hijos salían en la portada como hermanos del
 * padre, un hijo no decía de quién colgaba, y su pack mezclaba en silencio lo suyo con lo del
 * cliente.
 *
 * La regla que estos tests protegen: la herencia SUBE (un hijo ve lo del padre) y bajar es
 * siempre con permisos — un hijo privado del que no eres miembro no aparece por mirar al padre.
 */
const RID = Math.random().toString(36).slice(2, 8);
const USER = `jerarquia-${RID}@example.com`;
const AJENO = `ajeno-${RID}@example.com`;

async function otpDe(email: string): Promise<string> {
  // El emisor `log` imprime `[email:log] (asunto) to <email>: …`. Se busca el código EN LA
  // LÍNEA DE ESTE EMAIL, no el primer número de seis cifras que pase: varios ficheros de
  // integración interceptan `console.log` a la vez.
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
let hijo: ProjectRef;
let hijoPrivado: ProjectRef;

beforeAll(async () => {
  const { token } = await verifyOtp(USER, await otpDe(USER));
  cookie = `cortex_session=${token}`;

  // Todo esto es de OTRA persona y USER solo pasa por delante: ve el cliente y el repo
  // porque son públicos. El acceso cascadea por la jerarquía (ADR-0046), así que para probar
  // que un hijo privado no se cuela, quien mira no puede ser dueño ni miembro del padre —
  // serlo abre los hijos a propósito, y es otra cosa.
  cliente = await createProject(`Cliente ${RID}`, { ownerEmail: AJENO });
  hijo = await createProject(`Repo Backend ${RID}`, { ownerEmail: AJENO, parentSlug: cliente.slug! });
  hijoPrivado = await createProject(`Repo Secreto ${RID}`, {
    ownerEmail: AJENO,
    visibility: "private",
    parentSlug: cliente.slug!,
  });

  await saveContext({
    content: `El cliente ${RID} exige que todo despliegue pase por su bastión SSH.`,
    project: cliente.name,
    type: "constraint",
    createdBy: AJENO,
  });
  await saveContext({
    content: `En este repo ${RID} las migraciones se aplican con un job manual.`,
    project: hijo.name,
    type: "decision",
    createdBy: AJENO,
  });
}, 180_000);

const get = (ruta: string) => createWebApp().request(ruta, { headers: { cookie } });

describe("jerarquía de proyectos en la UI", () => {
  it("un hijo dice de quién cuelga, y el camino lleva hasta la raíz", async () => {
    const html = await (await get(`/p/${hijo.slug}`)).text();
    expect(html).toContain('class="crumbs"');
    expect(html).toContain(`href="/p/${cliente.slug}"`);
    expect(html).toContain(cliente.name);
  }, 60_000);

  it("un proyecto sin padre no pinta miga de pan (no hay camino que enseñar)", async () => {
    const html = await (await get(`/p/${cliente.slug}`)).text();
    expect(html).not.toContain('class="crumbs"');
  }, 60_000);

  it("un cliente enseña sus repos, con las mismas tarjetas de la portada", async () => {
    const html = await (await get(`/p/${cliente.slug}`)).text();
    expect(html).toContain("Projects in this client");
    expect(html).toContain(`href="/p/${hijo.slug}"`);
    expect(html).toContain("project-card");
  }, 60_000);

  it("un hijo privado ajeno no aparece por mirar al padre", async () => {
    // Lo que cruza hacia abajo filtra por permisos: ver al cliente no abre sus repos privados.
    for (const ruta of [`/p/${cliente.slug}`, "/"]) {
      const html = await (await get(ruta)).text();
      expect(html, ruta).not.toContain(hijoPrivado.slug!);
      expect(html, ruta).not.toContain(hijoPrivado.name);
    }
    // Y sigue siendo inalcanzable de frente, no solo invisible.
    expect((await get(`/p/${hijoPrivado.slug}`)).status).toBe(403);
  }, 60_000);

  it("la portada agrupa los hijos bajo su cliente en vez de mezclarlos como hermanos", async () => {
    const html = await (await get("/")).text();
    // El grupo de ESTE cliente: la portada lista todos los proyectos públicos de la BD de
    // test, así que el primer grupo de la página no tiene por qué ser el nuestro.
    const grupo = html.split('class="project-group"').find((g) => g.includes(`href="/p/${cliente.slug}"`));
    expect(grupo, "el cliente debe pintarse como grupo, no como tarjeta suelta").toBeTruthy();
    // El hijo se pinta DENTRO del grupo de su padre, no suelto en la rejilla de primer nivel.
    expect(grupo!.split('class="project-children"')[1] ?? "").toContain(`href="/p/${hijo.slug}"`);
  }, 120_000);

  it("lo que ven los agentes de un hijo dice qué parte es del cliente", async () => {
    const html = await (await get(`/p/${hijo.slug}/agents`)).text();
    expect(html).toContain(`from ${cliente.name}`);
    // La marca va en la entrada heredada, no en todas: la del propio repo no la lleva. Sin
    // esto, marcarlo todo (o no marcar nada) pasaría el test igual.
    const bloques = html.split('class="pack-entry"').slice(1);
    const marcados = bloques.filter((b) => b.includes('class="from-project"'));
    expect(bloques.length).toBe(2); // la restricción del cliente + la decisión del repo
    expect(marcados).toHaveLength(1);
    expect(marcados[0]!).toContain(`from ${cliente.name}`);
  }, 120_000);

  it("en el cliente no hay nada heredado que marcar", async () => {
    const html = await (await get(`/p/${cliente.slug}/agents`)).text();
    expect(html).not.toContain('class="from-project"');
  }, 60_000);

  it("las clases que solo salen con jerarquía también están estiladas", async () => {
    // `web-styles` recorre un proyecto suelto, así que no llega a ver ninguna de estas: sin
    // esto, la miga de pan o el grupo de la portada podrían salir sin una regla detrás.
    const css = readFileSync(resolve(import.meta.dirname, "../../apps/web/public/styles.css"), "utf8");
    const sinEstilo = new Set<string>();
    for (const ruta of ["/", `/p/${cliente.slug}`, `/p/${hijo.slug}`, `/p/${hijo.slug}/agents`]) {
      const html = await (await get(ruta)).text();
      const clases = new Set([...html.matchAll(/class="([^"]+)"/g)].flatMap((m) => m[1]!.split(/\s+/).filter(Boolean)));
      for (const c of clases) if (!css.includes(`.${c}`)) sinEstilo.add(`${c} (${ruta})`);
    }
    expect([...sinEstilo]).toEqual([]);
  }, 120_000);
});

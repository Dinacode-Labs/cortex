import { describe, it, expect, beforeAll } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { createProject, requestOtp, saveContext, verifyOtp, type ProjectRef } from "@cortex/core";
import { createApp as createWebApp } from "../../apps/web/src/app.js";

/**
 * Que lo que se pinta esté realmente estilado.
 *
 * Es un fallo silencioso y feo: el HTML sale con su `class`, el navegador no se queja, y la
 * página aparece a medio vestir. Pasó con la reestructuración —clases nuevas en las plantillas
 * y ninguna regla detrás— y no lo vio ningún test porque todos miraban el contenido, no el
 * aspecto. Esto compara las dos listas.
 */
const CSS = readFileSync(resolve(import.meta.dirname, "../../apps/web/public/styles.css"), "utf8");
const RID = Math.random().toString(36).slice(2, 8);
const USER = `styles-${RID}@example.com`;

async function otpDe(email: string): Promise<string> {
  // El emisor `log` imprime `[email:log] (asunto) to <email>: …`. Se busca el código EN LA
  // LÍNEA DE ESTE EMAIL, no el primer número de seis cifras que pase: varios ficheros de
  // integración interceptan `console.log` a la vez y, sin esto, uno se lleva el código de otro
  // y falla con «Código incorrecto» en un sitio que no tiene nada que ver.
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
let proyecto: ProjectRef;

beforeAll(async () => {
  const { token } = await verifyOtp(USER, await otpDe(USER));
  cookie = `cortex_session=${token}`;
  proyecto = await createProject(`Styles ${RID}`, { ownerEmail: USER });
  await saveContext({ content: `Una decisión cualquiera ${RID}.`, project: proyecto.name, createdBy: USER });
}, 120_000);

const clasesDe = (html: string): string[] => [
  ...new Set([...html.matchAll(/class="([^"]+)"/g)].flatMap((m) => m[1]!.split(/\s+/).filter(Boolean))),
];

describe("estilos de la UI", () => {
  it("toda clase que se pinta tiene una regla detrás", async () => {
    const web = createWebApp();
    const rutas = [
      "/",
      `/p/${proyecto.slug}`,
      `/p/${proyecto.slug}?capture=1`,
      `/p/${proyecto.slug}/health`,
      `/p/${proyecto.slug}/agents`,
      `/p/${proyecto.slug}/settings`,
      `/p/${proyecto.slug}/map`,
      `/p/${proyecto.slug}/code`,
      "/search?q=decision",
    ];
    const sinEstilo = new Set<string>();
    for (const ruta of rutas) {
      const html = await (await web.request(ruta, { headers: { cookie } })).text();
      for (const c of clasesDe(html)) if (!CSS.includes(`.${c}`)) sinEstilo.add(`${c} (${ruta})`);
    }
    expect([...sinEstilo]).toEqual([]);
  }, 180_000);

  it("la hoja de estilos va versionada, o el navegador sirve la vieja", async () => {
    // Sin `Cache-Control` ni `ETag` el navegador aplica su heurística y se queda la copia
    // anterior sin preguntar: un rediseño desplegado que nadie ve.
    const html = await (await createWebApp().request("/", { headers: { cookie } })).text();
    expect(html).toMatch(/\/styles\.css\?v=[^"]+/);
  });

  it("el CSS está balanceado (una llave suelta se come el resto del fichero)", () => {
    expect(CSS.split("{").length).toBe(CSS.split("}").length);
  });
});

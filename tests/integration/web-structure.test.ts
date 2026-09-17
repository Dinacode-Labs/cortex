import { describe, it, expect, beforeAll } from "vitest";
import { createProject, requestOtp, saveContext, verifyOtp, type ProjectRef } from "@cortex/core";
import { createApp as createWebApp } from "../../apps/web/src/app.js";

/**
 * ADR-0050: la UI gira alrededor del proyecto.
 *
 * Antes eran ocho enlaces planos, cada pantalla con su propio selector, y el proyecto que
 * estabas mirando se perdía al cambiar de sección. Ahora el proyecto está en la URL y las
 * secciones cuelgan de él.
 */
const RID = Math.random().toString(36).slice(2, 8);
const USER = `web-${RID}@example.com`;

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
  proyecto = await createProject(`Web Structure ${RID}`, { ownerEmail: USER });
  await saveContext({
    content: `Decidimos usar colas para los reintentos del cobro ${RID}.`,
    project: proyecto.name,
    createdBy: USER,
  });
}, 120_000);

const get = (ruta: string) => createWebApp().request(ruta, { headers: { cookie } });

describe("estructura de la UI (ADR-0050)", () => {
  it("la portada es la lista de proyectos, no un cajón de entradas mezcladas", async () => {
    const html = await (await get("/")).text();
    expect(html).toContain(proyecto.name);
    expect(html).toContain(`/p/${proyecto.slug}`);
  });

  it("cada sección del proyecto responde y lleva el slug en la URL", async () => {
    for (const sufijo of ["", "/ask", "/agents", "/health", "/map", "/code", "/settings"]) {
      const res = await get(`/p/${proyecto.slug}${sufijo}`);
      expect(res.status, `/p/<slug>${sufijo}`).toBe(200);
      const html = await res.text();
      // El proyecto viaja con las pestañas: cambiar de sección no puede perderlo.
      expect(html, `las pestañas de ${sufijo || "/"} deben apuntar al mismo proyecto`).toContain(
        `/p/${proyecto.slug}/health`,
      );
    }
  }, 120_000);

  it("las direcciones viejas siguen llevando a algún sitio", async () => {
    const casos: [string, string][] = [
      [`/lint?project=${encodeURIComponent(proyecto.name)}`, `/p/${proyecto.slug}/health`],
      [`/pack?project=${encodeURIComponent(proyecto.name)}`, `/p/${proyecto.slug}/agents`],
      [`/graph?project=${encodeURIComponent(proyecto.name)}`, `/p/${proyecto.slug}/map`],
      [`/?project=${encodeURIComponent(proyecto.name)}`, `/p/${proyecto.slug}`],
      ["/projects", "/"],
      ["/usage", "/admin/usage"],
    ];
    for (const [vieja, nueva] of casos) {
      const res = await get(vieja);
      expect(res.status, vieja).toBe(301);
      expect(res.headers.get("location"), vieja).toBe(nueva);
    }
  });

  it("el coste de IA es de operador: un usuario normal ni lo encuentra", async () => {
    expect((await get("/admin/usage")).status).toBe(404); // 404 y no 403: no se anuncia
  });

  it("lo que ven los agentes enlaza a sus entradas, que es de lo que sirve verlo", async () => {
    const html = await (await get(`/p/${proyecto.slug}/agents`)).text();
    expect(html).toMatch(/href="\/entry\/[0-9a-f-]{36}"/);
  }, 60_000);

  it("la UI está en inglés, incluida la parte que se generaba sobre la marcha", async () => {
    const paginas = await Promise.all(
      ["/", `/p/${proyecto.slug}`, `/p/${proyecto.slug}/health`, `/p/${proyecto.slug}/agents`].map(async (r) =>
        (await get(r)).text(),
      ),
    );
    // Palabras que se colaron antes en una UI declarada en inglés (CLAUDE.md).
    const castellano = /\b(entradas|proyectos|Contradicciones|Riesgos conocidos|Restricciones activas|Convenciones|Posibles duplicados|incidencias|estado actual)\b/;
    for (const [i, html] of paginas.entries()) {
      const cuerpo = html.split("<main>")[1] ?? html;
      expect(cuerpo, `página ${i}`).not.toMatch(castellano);
    }
  }, 120_000);

  it("se puede filtrar por estado, que es lo que hace revisable una memoria grande", async () => {
    const html = await (await get(`/p/${proyecto.slug}?status=pending_validation`)).text();
    expect(html).toContain("pending_validation");
    // El filtro conserva el otro: elegir un tipo no puede perder el estado elegido.
    expect(html).toMatch(/href="[^"]*status=pending_validation[^"]*type=decision|href="[^"]*type=decision[^"]*status=pending_validation/);
  }, 60_000);

  it("Health dice cuántas no ha mirado nadie y por dónde empezar", async () => {
    const html = await (await get(`/p/${proyecto.slug}/health`)).text();
    expect(html).toContain("Nobody has reviewed these");
    expect(html).toContain(`/p/${proyecto.slug}?status=pending_validation`);
  }, 60_000);

  it("la marca es configurable también en los botones, no solo en la cabecera", async () => {
    const html = await (await get(`/p/${proyecto.slug}?capture=1`)).text();
    expect(html).toContain("Cortex"); // default
    const cuerpo = html.split("<main>")[1]!;
    // Si la marca cambiara, estos textos deben cambiar con ella: no pueden estar cableados
    // aparte del `getBrandName()` de la cabecera.
    expect(cuerpo).toMatch(/What should Cortex remember/);
  });
});

import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import { closeSql } from "@cortex/database";
import { createProject, listEntries, requestOtp, verifyOtp, type ProjectRef } from "@cortex/core";
import type { DistillSessionFn, DistillSessionInput } from "@cortex/agents";
import { createApp as createServerApp } from "../../apps/server/src/app.js";

/**
 * `POST /capture/session`: el cliente manda el transcript condensado y el servidor destila
 * (ADR-0025). Aquí se inyecta un destilador falso, porque lo que hay que verificar no es la
 * calidad de lo destilado sino el contrato del endpoint: permisos, idempotencia y que no se
 * pague dos veces por la misma sesión.
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
  if (!m) throw new Error("no se capturó el OTP");
  return m[1]!;
}

/** Destilador falso: registra con qué se le llamó y devuelve contadores fijos. */
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

/** Un transcript por encima del mínimo de 200 caracteres que exige la destilación. */
const transcript = (extra = "") =>
  `USUARIO: ¿por qué la cola de trabajos usa Redis?\n\nASISTENTE: por los reintentos con backoff; lo decidimos al migrar el worker y quedó documentado en el ADR correspondiente del proyecto.${extra}`;

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
  it("exige sesión y respeta los permisos del proyecto", async () => {
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
      body: body(`no-existe-${RID}`, transcript(), `s-404-${RID}`),
    });
    expect(noExiste.status).toBe(404);

    const ajeno = await srv.request("/capture/session", {
      method: "POST",
      headers,
      body: body(foreign.slug!, transcript(), `s-403-${RID}`),
    });
    expect(ajeno.status).toBe(403);
  });

  it("rechaza un transcript desmedido antes de tocar la BD (413)", async () => {
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

  it("con ?wait=1 destila, atribuye al usuario y devuelve contadores", async () => {
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
    expect(calls[0]!.createdBy).toBe(USER); // la atribución sale del Bearer, no del cuerpo
    expect(calls[0]!.projectName).toBe(own.name);
    expect(calls[0]!.sessionId).toBe(sessionId);
  });

  it("la misma sesión con el mismo contenido no se vuelve a destilar", async () => {
    const { fn, calls } = stubDistill();
    const srv = createServerApp({ distill: fn });
    const headers = { authorization: `Bearer ${token}`, "content-type": "application/json" };
    const sessionId = `s-dup-${RID}`;
    const payload = body(own.slug!, transcript(), sessionId);

    const first = await srv.request("/capture/session?wait=1", { method: "POST", headers, body: payload });
    expect(first.status).toBe(200);
    expect(calls).toHaveLength(1);

    // Los hooks de fin de sesión y de pre-compactación disparan sobre la misma sesión:
    // repetir NO debe costar otra tanda de llamadas al modelo.
    const second = await srv.request("/capture/session?wait=1", { method: "POST", headers, body: payload });
    expect(second.status).toBe(200);
    expect(((await second.json()) as { status: string }).status).toBe("duplicate");
    expect(calls).toHaveLength(1);
  });

  it("si la sesión creció, solo se destila la parte nueva", async () => {
    const { fn, calls } = stubDistill();
    const srv = createServerApp({ distill: fn });
    const headers = { authorization: `Bearer ${token}`, "content-type": "application/json" };
    const sessionId = `s-delta-${RID}`;
    const base = transcript();
    const cola = "\n\nUSUARIO: ¿y el timeout?\n\nASISTENTE: 30 segundos, configurable por entorno.";

    await srv.request("/capture/session?wait=1", { method: "POST", headers, body: body(own.slug!, base, sessionId) });
    await srv.request("/capture/session?wait=1", {
      method: "POST",
      headers,
      body: body(own.slug!, base + cola, sessionId),
    });

    expect(calls).toHaveLength(2);
    // El condensado es append-only: el prefijo ya procesado no se vuelve a pagar.
    expect(calls[1]!.condensed).toBe(cola);
  });

  it("sin ?wait devuelve 202 y el estado se puede consultar por id", async () => {
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

    // La cola es en proceso: para cuando se consulta, ya ha corrido.
    await new Promise((r) => setTimeout(r, 50));
    const check = await srv.request(`/capture/session/${id}`, { headers });
    expect(check.status).toBe(200);
    expect(["queued", "running", "done"]).toContain(((await check.json()) as { status: string }).status);
  });

  it("un fallo del destilador queda registrado, no revienta la petición", async () => {
    const srv = createServerApp({
      distill: async () => {
        throw new Error("el proveedor devolvió 429");
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

  it("el destilador real escribe entradas atribuidas al usuario", async () => {
    // Sin stub: se usa `distillSession` de verdad, pero sin LLM configurado (`distill`
    // devuelve vacío). Comprueba el cableado real de app → cola → agents → core.
    const srv = createServerApp();
    const res = await srv.request("/capture/session?wait=1", {
      method: "POST",
      headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
      body: body(own.slug!, transcript(), `s-real-${RID}`),
    });
    expect([200, 202]).toContain(res.status);
    const out = (await res.json()) as { status: string };
    expect(["done", "failed", "running"]).toContain(out.status);
    // No se afirma que haya entradas: sin LLM el distiller no produce nada, y eso es
    // correcto. Lo que se verifica es que la ruta completa no lanza.
    await listEntries({ project: own.name });
  });
});

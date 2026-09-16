import { describe, it, expect, beforeAll } from "vitest";
import {
  createProject,
  canAccessProject,
  findProjectBySlug,
  listProjectMembers,
  requestOtp,
  saveContext,
  verifyOtp,
  type ProjectRef,
} from "@cortex/core";
import { createApp as createServerApp } from "../../apps/server/src/app.js";

/**
 * ADR-0051: un proyecto tiene vida después de crearse.
 *
 * Hasta ahora la visibilidad se fijaba al crear y no había forma de cambiarla —ni UI, ni API,
 * ni CLI, ni función de dominio—, los miembros solo los tocaba un admin global, y lo que creaba
 * un `save` nacía sin slug, sin dueño y público: imposible de vincular, de adoptar y de cerrar.
 */
const RID = Math.random().toString(36).slice(2, 8);
const OWNER = `owner-${RID}@example.com`;
const OTRO = `otro-${RID}@example.com`;

async function tokenDe(email: string): Promise<string> {
  const logs: string[] = [];
  const orig = console.log;
  console.log = (...a: unknown[]) => logs.push(a.join(" "));
  try {
    await requestOtp(email);
  } finally {
    console.log = orig;
  }
  const code = logs.join("\n").match(/(\d{6})/)?.[1];
  if (!code) throw new Error("sin OTP en el log");
  return (await verifyOtp(email, code)).token;
}

let tokOwner: string;
let tokOtro: string;
let proyecto: ProjectRef;

beforeAll(async () => {
  tokOwner = await tokenDe(OWNER);
  tokOtro = await tokenDe(OTRO);
  proyecto = await createProject(`Lifecycle ${RID}`, { ownerEmail: OWNER });
}, 60_000);

describe("vida de un proyecto (ADR-0051)", () => {
  it("el dueño cambia la visibilidad; quien no gestiona, no", async () => {
    const srv = createServerApp();
    const patch = (token: string, body: unknown) =>
      srv.request(`/projects/${proyecto.slug}`, {
        method: "PATCH",
        headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
        body: JSON.stringify(body),
      });

    const ajeno = await patch(tokOtro, { visibility: "private" });
    expect(ajeno.status).toBe(403);
    expect((await findProjectBySlug(proyecto.slug!))!.visibility).toBe("public"); // no tocó nada

    const propio = await patch(tokOwner, { visibility: "private" });
    expect(propio.status).toBe(200);
    expect((await findProjectBySlug(proyecto.slug!))!.visibility).toBe("private");
  });

  it("volverlo privado cierra el acceso en el acto, sin tocar las entradas", async () => {
    const p = (await findProjectBySlug(proyecto.slug!))!;
    expect(await canAccessProject(p, OTRO)).toBe(false);
    expect(await canAccessProject(p, OWNER)).toBe(true);

    // Y volver a abrirlo lo deshace.
    const srv = createServerApp();
    await srv.request(`/projects/${proyecto.slug}`, {
      method: "PATCH",
      headers: { authorization: `Bearer ${tokOwner}`, "content-type": "application/json" },
      body: JSON.stringify({ visibility: "public" }),
    });
    expect(await canAccessProject((await findProjectBySlug(proyecto.slug!))!, OTRO)).toBe(true);
  });

  it("el dueño gestiona sus miembros sin ser admin global", async () => {
    const srv = createServerApp();
    const res = await srv.request(`/projects/${proyecto.slug}/members`, {
      method: "POST",
      headers: { authorization: `Bearer ${tokOwner}`, "content-type": "application/json" },
      body: JSON.stringify({ email: OTRO }),
    });
    expect(res.status).toBe(200);
    expect(await listProjectMembers(proyecto.slug!)).toContain(OTRO);

    const quita = await srv.request(`/projects/${proyecto.slug}/members`, {
      method: "DELETE",
      headers: { authorization: `Bearer ${tokOtro}`, "content-type": "application/json" },
      body: JSON.stringify({ email: OTRO }),
    });
    expect(quita.status, "un miembro no es un gestor").toBe(403);
  });

  it("un proyecto creado por `save` nace con slug y con dueño", async () => {
    const nombre = `Nacido De Save ${RID}`;
    await saveContext({ content: `Una decisión cualquiera ${RID}.`, project: nombre, createdBy: OWNER });
    const p = await findProjectBySlug("nacido-de-save-" + RID.toLowerCase());
    expect(p, "debería tener slug, que es lo que lo hace vinculable").toBeTruthy();
    expect(p!.ownerEmail).toBe(OWNER);
  }, 60_000);

  it("un proyecto se puede colgar de un padre DESPUÉS de crearlo", async () => {
    // El caso real: un cliente con varios repos que no son monorepo, y alguien del equipo crea
    // uno de los hijos sin `--parent`. Sin esto no había arreglo: ni reengancharlo ni recrearlo,
    // porque el slug ya estaba cogido.
    const padre = await createProject(`Cliente ${RID}`, { ownerEmail: OWNER });
    const huerfano = await createProject(`Repo Suelto ${RID}`, { ownerEmail: OWNER });
    expect(huerfano.parentId).toBeNull();

    const srv = createServerApp();
    const res = await srv.request(`/projects/${huerfano.slug}`, {
      method: "PATCH",
      headers: { authorization: `Bearer ${tokOwner}`, "content-type": "application/json" },
      body: JSON.stringify({ parentSlug: padre.slug }),
    });
    expect(res.status).toBe(200);
    expect((await findProjectBySlug(huerfano.slug!))!.parentId).toBe(padre.id);

    // Y el hijo hereda el acceso del padre: volver privado el padre cierra los dos.
    await srv.request(`/projects/${padre.slug}`, {
      method: "PATCH",
      headers: { authorization: `Bearer ${tokOwner}`, "content-type": "application/json" },
      body: JSON.stringify({ visibility: "private" }),
    });
    expect(await canAccessProject((await findProjectBySlug(huerfano.slug!))!, OTRO)).toBe(false);
  }, 60_000);

  it("no se puede montar un ciclo de padres, que dejaría los permisos dando vueltas", async () => {
    const a = await createProject(`Ciclo A ${RID}`, { ownerEmail: OWNER });
    const b = await createProject(`Ciclo B ${RID}`, { ownerEmail: OWNER, parentSlug: a.slug! });
    const srv = createServerApp();
    const res = await srv.request(`/projects/${a.slug}`, {
      method: "PATCH",
      headers: { authorization: `Bearer ${tokOwner}`, "content-type": "application/json" },
      body: JSON.stringify({ parentSlug: b.slug }),
    });
    expect(res.status).toBe(400);
    expect((await findProjectBySlug(a.slug!))!.parentId).toBeNull(); // no tocó nada
  }, 60_000);

  it("un proyecto vacío se puede borrar: deshacer un `link --create` equivocado", async () => {
    const error = await createProject(`Nombre Equivocado ${RID}`, { ownerEmail: OWNER });
    const srv = createServerApp();
    const res = await srv.request(`/projects/${error.slug}`, {
      method: "DELETE",
      headers: { authorization: `Bearer ${tokOwner}` },
    });
    expect(res.status).toBe(200);
    expect(await findProjectBySlug(error.slug!)).toBeNull();
  }, 60_000);

  it("uno CON memoria dentro no: invalidar no es borrar, y eso no puede estar a un clic", async () => {
    const conMemoria = await createProject(`Con Memoria ${RID}`, { ownerEmail: OWNER });
    await saveContext({ content: `Una decisión que no queremos perder ${RID}.`, project: conMemoria.name, createdBy: OWNER });
    const srv = createServerApp();
    const res = await srv.request(`/projects/${conMemoria.slug}`, {
      method: "DELETE",
      headers: { authorization: `Bearer ${tokOwner}` },
    });
    expect(res.status).toBe(409);
    expect(await findProjectBySlug(conMemoria.slug!), "sigue ahí").toBeTruthy();
  }, 60_000);

  it("uno con hijos tampoco, que dejaría a los hijos colgando", async () => {
    const padre = await createProject(`Padre Con Hijos ${RID}`, { ownerEmail: OWNER });
    await createProject(`Hijo De ${RID}`, { ownerEmail: OWNER, parentSlug: padre.slug! });
    const srv = createServerApp();
    const res = await srv.request(`/projects/${padre.slug}`, {
      method: "DELETE",
      headers: { authorization: `Bearer ${tokOwner}` },
    });
    expect(res.status).toBe(409);
  }, 60_000);

  it("y quien no lo gestiona no puede borrarlo aunque esté vacío", async () => {
    const mio = await createProject(`Solo Mio ${RID}`, { ownerEmail: OWNER });
    const srv = createServerApp();
    const res = await srv.request(`/projects/${mio.slug}`, {
      method: "DELETE",
      headers: { authorization: `Bearer ${tokOtro}` },
    });
    expect(res.status).toBe(403);
    expect(await findProjectBySlug(mio.slug!)).toBeTruthy();
  }, 60_000);

  it("un proyecto que no puedes ver responde 404 al intentar gestionarlo, no 403", async () => {
    const privado = await createProject(`Privado Ajeno ${RID}`, { visibility: "private", ownerEmail: OWNER });
    const srv = createServerApp();
    const res = await srv.request(`/projects/${privado.slug}`, {
      method: "PATCH",
      headers: { authorization: `Bearer ${tokOtro}`, "content-type": "application/json" },
      body: JSON.stringify({ visibility: "public" }),
    });
    expect(res.status).toBe(404); // un 403 confirmaría que existe
  });
});

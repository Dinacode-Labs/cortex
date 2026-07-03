import { describe, it, expect, afterAll } from "vitest";
import { closeSql } from "@cortex/database";
import { createProject, canAccessProject, addProjectMember, findProjectBySlug, saveContext, listEntries, getEntryProject } from "@cortex/core";

const RID = Date.now().toString(36);
afterAll(async () => {
  await closeSql();
});

describe("permisos de proyecto (público/privado, admin, miembros, cascada)", () => {
  it("público accesible por cualquiera; privado solo dueño/miembro/admin", async () => {
    const pub = await createProject(`IT Pub ${RID}`, { visibility: "public", ownerEmail: "ana@dinacode.com" });
    const prv = await createProject(`IT Prv ${RID}`, { visibility: "private", ownerEmail: "ana@dinacode.com" });

    expect(await canAccessProject(pub, "cualquiera@dinacode.com")).toBe(true);
    expect(await canAccessProject(prv, "ana@dinacode.com")).toBe(true); // dueño
    expect(await canAccessProject(prv, "bob@dinacode.com")).toBe(false); // ajeno
    expect(await canAccessProject(prv, "admin@dinacode.com")).toBe(true); // admin (env)

    await addProjectMember(prv.slug!, "bob@dinacode.com");
    const prv2 = (await findProjectBySlug(prv.slug!))!;
    expect(await canAccessProject(prv2, "bob@dinacode.com")).toBe(true); // ahora miembro
  });

  it("getEntryProject resuelve el proyecto de una entrada → permite el gate por ID de entrada", async () => {
    // Las operaciones por ID de entrada (validar / relacionar) usan getEntryProject +
    // canAccessProject para no saltarse los permisos del proyecto privado de la entrada.
    const prv = await createProject(`IT Entry Prv ${RID}`, { visibility: "private", ownerEmail: "ana@dinacode.com" });
    await saveContext({ content: "Secreto: la API de facturación usa una clave dedicada.", project: prv.name, type: "constraint" });
    const [entry] = await listEntries({ project: prv.name });
    expect(entry).toBeTruthy();

    const proj = await getEntryProject(entry!.id);
    expect(proj?.id).toBe(prv.id);
    expect(await canAccessProject(proj!, "ana@dinacode.com")).toBe(true); // dueño
    expect(await canAccessProject(proj!, "ajeno@dinacode.com")).toBe(false); // sin acceso → bloqueado

    expect(await getEntryProject("00000000-0000-0000-0000-000000000000")).toBeNull(); // entrada inexistente
  });

  it("cascada: subproyecto público bajo padre privado queda restringido", async () => {
    const parent = await createProject(`IT Casc ${RID}`, { visibility: "private", ownerEmail: "ana@dinacode.com" });
    const child = await createProject(`IT Casc Child ${RID}`, { parentSlug: parent.slug! }); // público por defecto
    const c = (await findProjectBySlug(child.slug!))!;
    expect(c.visibility).toBe("public");
    expect(await canAccessProject(c, "ana@dinacode.com")).toBe(true); // dueño del padre
    expect(await canAccessProject(c, "carlos@dinacode.com")).toBe(false); // hereda la restricción del padre
    expect(await canAccessProject(c, "admin@dinacode.com")).toBe(true);
  });
});

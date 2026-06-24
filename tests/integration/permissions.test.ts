import { describe, it, expect, afterAll } from "vitest";
import { closeSql } from "@cortex/database";
import { createProject, canAccessProject, addProjectMember, findProjectBySlug } from "@cortex/core";

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

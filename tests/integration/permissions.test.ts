import { describe, it, expect, afterAll } from "vitest";
import { closeSql } from "@cortex/database";
import { createProject, canAccessProject, addProjectMember, findProjectBySlug, saveContext, searchContext, listEntries, getEntryProject } from "@cortex/core";

const RID = Date.now().toString(36);
afterAll(async () => {
  await closeSql();
});

describe("permisos de proyecto (público/privado, admin, miembros, cascada)", () => {
  it("público accesible por cualquiera; privado solo dueño/miembro/admin", async () => {
    const pub = await createProject(`IT Pub ${RID}`, { visibility: "public", ownerEmail: "ana@example.com" });
    const prv = await createProject(`IT Prv ${RID}`, { visibility: "private", ownerEmail: "ana@example.com" });

    expect(await canAccessProject(pub, "cualquiera@example.com")).toBe(true);
    expect(await canAccessProject(prv, "ana@example.com")).toBe(true); // dueño
    expect(await canAccessProject(prv, "bob@example.com")).toBe(false); // ajeno
    expect(await canAccessProject(prv, "admin@example.com")).toBe(true); // admin (env)

    await addProjectMember(prv.slug!, "bob@example.com");
    const prv2 = (await findProjectBySlug(prv.slug!))!;
    expect(await canAccessProject(prv2, "bob@example.com")).toBe(true); // ahora miembro
  });

  it("getEntryProject resuelve el proyecto de una entrada → permite el gate por ID de entrada", async () => {
    // Las operaciones por ID de entrada (validar / relacionar) usan getEntryProject +
    // canAccessProject para no saltarse los permisos del proyecto privado de la entrada.
    const prv = await createProject(`IT Entry Prv ${RID}`, { visibility: "private", ownerEmail: "ana@example.com" });
    await saveContext({ content: "Secreto: la API de facturación usa una clave dedicada.", project: prv.name, type: "constraint" });
    const [entry] = await listEntries({ project: prv.name });
    expect(entry).toBeTruthy();

    const proj = await getEntryProject(entry!.id);
    expect(proj?.id).toBe(prv.id);
    expect(await canAccessProject(proj!, "ana@example.com")).toBe(true); // dueño
    expect(await canAccessProject(proj!, "ajeno@example.com")).toBe(false); // sin acceso → bloqueado

    expect(await getEntryProject("00000000-0000-0000-0000-000000000000")).toBeNull(); // entrada inexistente
  });

  it("searchContext sin proyecto: restringe a proyectos accesibles (P0, no filtra privados ajenos)", async () => {
    // Fuga P0 (backlog #1): buscar SIN proyecto no puede devolver entradas de proyectos
    // privados ajenos. El scoping va en core (opts.restrictToAccessibleOf), compartido
    // por MCP y web. Este test fallaría si se revierte el fix (searchContext buscaría en
    // TODO y el marcador aparecería con el email de userB, que no es miembro).
    const userA = `owner-search-${RID}@example.com`;
    const userB = `ajeno-search-${RID}@example.com`; // NO miembro, NO admin
    const marker = `MARCADORSECRETO${RID}`; // marcador único en el contenido
    const prv = await createProject(`IT Search Prv ${RID}`, { visibility: "private", ownerEmail: userA });
    await saveContext({ content: `Secreto: la clave es ${marker}.`, project: prv.name, type: "constraint" });

    const foundBy = async (email: string | null) =>
      (await searchContext({ query: marker, limit: 20 }, { restrictToAccessibleOf: email })).some(
        (h) => h.entry.content.includes(marker),
      );

    // userB (ajeno) NO debe ver la entrada del privado de userA.
    expect(await foundBy(userB)).toBe(false);
    // userA (dueño) SÍ.
    expect(await foundBy(userA)).toBe(true);
    // Sin opts (llamada confiable, p.ej. stdio local) → busca en TODO → SÍ.
    const trusted = await searchContext({ query: marker, limit: 20 });
    expect(trusted.some((h) => h.entry.content.includes(marker))).toBe(true);
  });

  it("cascada: subproyecto público bajo padre privado queda restringido", async () => {
    const parent = await createProject(`IT Casc ${RID}`, { visibility: "private", ownerEmail: "ana@example.com" });
    const child = await createProject(`IT Casc Child ${RID}`, { parentSlug: parent.slug! }); // público por defecto
    const c = (await findProjectBySlug(child.slug!))!;
    expect(c.visibility).toBe("public");
    expect(await canAccessProject(c, "ana@example.com")).toBe(true); // dueño del padre
    expect(await canAccessProject(c, "carlos@example.com")).toBe(false); // hereda la restricción del padre
    expect(await canAccessProject(c, "admin@example.com")).toBe(true);
  });
});

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

    // Quien añade es el dueño: gestionar un proyecto ya no es solo cosa del admin (ADR-0051).
    await addProjectMember(prv.slug!, "bob@example.com", "ana@example.com");
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

describe("herencia en la búsqueda (roadmap: lo que ya estaba doliendo)", () => {
  /**
   * El context pack ya subía por la cadena de ancestros y la búsqueda no. Así que lo
   * transversal de un cliente —contratos, convenciones, con quién se habla— se guardaba en el
   * proyecto padre y NO se encontraba desde el repo del hijo, que es justo donde hace falta.
   *
   * Subir es seguro porque `canAccessProject` restringe el hijo si cualquier ancestro es
   * privado: tener acceso al hijo implica tenerlo a toda la cadena.
   */
  it("buscar dentro de un hijo encuentra lo guardado en el padre", async () => {
    const RID2 = Math.random().toString(36).slice(2, 8);
    const padre = await createProject(`Cliente Busq ${RID2}`, { ownerEmail: "ana@example.com" });
    const hijo = await createProject(`Repo Busq ${RID2}`, { ownerEmail: "ana@example.com", parentSlug: padre.slug! });

    const delPadre = `El cliente exige facturacion trimestral por adelantado ${RID2}.`;
    await saveContext({ content: delPadre, project: padre.name, createdBy: "ana@example.com" });
    await saveContext({ content: `El repositorio usa pnpm y Node 22 ${RID2}.`, project: hijo.name, createdBy: "ana@example.com" });

    const hits = await searchContext({ query: `facturacion trimestral ${RID2}`, project: hijo.name, limit: 10 });
    expect(hits.some((h) => h.entry.content.includes("facturacion trimestral")), "lo del padre no llegó").toBe(true);
  }, 120_000);

  it("pero no baja: desde el padre no se ve lo del hijo", async () => {
    const RID3 = Math.random().toString(36).slice(2, 8);
    const padre = await createProject(`Cliente Solo ${RID3}`, { ownerEmail: "ana@example.com" });
    const hijo = await createProject(`Repo Solo ${RID3}`, { ownerEmail: "ana@example.com", parentSlug: padre.slug! });
    const delHijo = `Detalle interno del repositorio hijo ${RID3}.`;
    await saveContext({ content: delHijo, project: hijo.name, createdBy: "ana@example.com" });

    const hits = await searchContext({ query: `detalle interno repositorio ${RID3}`, project: padre.name, limit: 10 });
    expect(hits.some((h) => h.entry.content.includes(delHijo)), "un hermano no debe ver lo del otro").toBe(false);
  }, 120_000);
});

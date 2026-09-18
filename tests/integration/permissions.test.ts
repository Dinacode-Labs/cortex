import { describe, it, expect, afterAll } from "vitest";
import { closeSql } from "@cortex/database";
import { createProject, canAccessProject, addProjectMember, findProjectBySlug, saveContext, searchContext, listEntries, getEntryProject } from "@cortex/core";

const RID = Date.now().toString(36);
afterAll(async () => {
  await closeSql();
});

describe("project permissions (public/private, admin, members, cascade)", () => {
  it("public is accessible to anyone; private only to owner/member/admin", async () => {
    const pub = await createProject(`IT Pub ${RID}`, { visibility: "public", ownerEmail: "ana@example.com" });
    const prv = await createProject(`IT Prv ${RID}`, { visibility: "private", ownerEmail: "ana@example.com" });

    expect(await canAccessProject(pub, "cualquiera@example.com")).toBe(true);
    expect(await canAccessProject(prv, "ana@example.com")).toBe(true); // the owner
    expect(await canAccessProject(prv, "bob@example.com")).toBe(false); // an outsider
    expect(await canAccessProject(prv, "admin@example.com")).toBe(true); // admin (env)

    // The one adding is the owner: managing a project is no longer admin-only (ADR-0051).
    await addProjectMember(prv.slug!, "bob@example.com", "ana@example.com");
    const prv2 = (await findProjectBySlug(prv.slug!))!;
    expect(await canAccessProject(prv2, "bob@example.com")).toBe(true); // now a member
  });

  it("getEntryProject resolves an entry's project → it enables the per-entry-id gate", async () => {
    // The operations by entry id (validate / relate) use getEntryProject plus canAccessProject
    // so they do not skip the permissions of the entry's private project.
    const prv = await createProject(`IT Entry Prv ${RID}`, { visibility: "private", ownerEmail: "ana@example.com" });
    await saveContext({ content: "Secret: the billing API uses a dedicated key.", project: prv.name, type: "constraint" });
    const [entry] = await listEntries({ project: prv.name });
    expect(entry).toBeTruthy();

    const proj = await getEntryProject(entry!.id);
    expect(proj?.id).toBe(prv.id);
    expect(await canAccessProject(proj!, "ana@example.com")).toBe(true); // the owner
    expect(await canAccessProject(proj!, "ajeno@example.com")).toBe(false); // no access → blocked

    expect(await getEntryProject("00000000-0000-0000-0000-000000000000")).toBeNull(); // an entry that does not exist
  });

  it("searchContext with no project: restricted to accessible projects (P0, no leaking of other people's private ones)", async () => {
    // P0 leak (backlog #1): searching WITHOUT a project must not return entries from other
    // people's private projects. The scoping lives in core (opts.restrictToAccessibleOf),
    // shared by MCP and web. This test would fail if the fix were reverted (searchContext
    // would search EVERYTHING and the marker would show up for userB, who is not a member).
    const userA = `owner-search-${RID}@example.com`;
    const userB = `outsider-search-${RID}@example.com`; // NOT a member, NOT an admin
    const marker = `SECRETMARKER${RID}`; // a unique marker inside the content
    const prv = await createProject(`IT Search Prv ${RID}`, { visibility: "private", ownerEmail: userA });
    await saveContext({ content: `Secret: the key is ${marker}.`, project: prv.name, type: "constraint" });

    const foundBy = async (email: string | null) =>
      (await searchContext({ query: marker, limit: 20 }, { restrictToAccessibleOf: email })).some(
        (h) => h.entry.content.includes(marker),
      );

    // userB (an outsider) must NOT see the entry from userA's private project.
    expect(await foundBy(userB)).toBe(false);
    // userA (the owner) does.
    expect(await foundBy(userA)).toBe(true);
    // With no opts (a trusted call, local stdio for instance) → it searches EVERYTHING → yes.
    const trusted = await searchContext({ query: marker, limit: 20 });
    expect(trusted.some((h) => h.entry.content.includes(marker))).toBe(true);
  });

  it("cascade: a public sub-project under a private parent stays restricted", async () => {
    const parent = await createProject(`IT Casc ${RID}`, { visibility: "private", ownerEmail: "ana@example.com" });
    const child = await createProject(`IT Casc Child ${RID}`, { parentSlug: parent.slug! }); // public by default
    const c = (await findProjectBySlug(child.slug!))!;
    expect(c.visibility).toBe("public");
    expect(await canAccessProject(c, "ana@example.com")).toBe(true); // the parent's owner
    expect(await canAccessProject(c, "carlos@example.com")).toBe(false); // it inherits the parent's restriction
    expect(await canAccessProject(c, "admin@example.com")).toBe(true);
  });
});

describe("inheritance in search (roadmap: what was already hurting)", () => {
  /**
   * The context pack already climbed the ancestor chain and search did not. So a client's
   * cross-cutting knowledge -- contracts, conventions, who to talk to -- was stored in the
   * parent project and could NOT be found from the child's repo, which is exactly where it is
   * needed.
   *
   * Going up is safe because `canAccessProject` restricts the child when any ancestor is
   * private: having access to the child implies having it to the whole chain.
   */
  it("searching inside a child finds what is stored in the parent", async () => {
    const RID2 = Math.random().toString(36).slice(2, 8);
    const parent_ = await createProject(`Cliente Busq ${RID2}`, { ownerEmail: "ana@example.com" });
    const child_ = await createProject(`Repo Busq ${RID2}`, { ownerEmail: "ana@example.com", parentSlug: parent_.slug! });

    const fromParent = `The client requires quarterly billing in advance ${RID2}.`;
    await saveContext({ content: fromParent, project: parent_.name, createdBy: "ana@example.com" });
    await saveContext({ content: `The repository uses pnpm and Node 22 ${RID2}.`, project: child_.name, createdBy: "ana@example.com" });

    const hits = await searchContext({ query: `facturacion trimestral ${RID2}`, project: child_.name, limit: 10 });
    expect(hits.some((h) => h.entry.content.includes("quarterly billing")), "the parent's knowledge did not arrive").toBe(true);
  }, 120_000);

  it("but it does not go down: from the parent you do not see the child's", async () => {
    const RID3 = Math.random().toString(36).slice(2, 8);
    const parent_ = await createProject(`Cliente Solo ${RID3}`, { ownerEmail: "ana@example.com" });
    const child_ = await createProject(`Repo Solo ${RID3}`, { ownerEmail: "ana@example.com", parentSlug: parent_.slug! });
    const fromChild = `An internal detail of the child_ repository ${RID3}.`;
    await saveContext({ content: fromChild, project: child_.name, createdBy: "ana@example.com" });

    const hits = await searchContext({ query: `detalle interno repositorio ${RID3}`, project: parent_.name, limit: 10 });
    expect(hits.some((h) => h.entry.content.includes(fromChild)), "one sibling must not see the other's").toBe(false);
  }, 120_000);
});

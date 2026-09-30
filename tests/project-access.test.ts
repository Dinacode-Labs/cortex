import { describe, it, expect } from "vitest";
import { decideProjectAccess, type ProjectChainNode } from "../packages/core/src/projects/domain/project.js";

/**
 * The access rule used to live inside a function that also ran the recursive SQL to load the
 * ancestor chain, so checking it meant a database. It is pure now (ADR-0076): the chain and
 * membership arrive as data.
 */
const PUBLIC: ProjectChainNode = { id: "root", visibility: "public", ownerEmail: null };
const privateNode = (id: string, owner: string | null = null): ProjectChainNode => ({ id, visibility: "private", ownerEmail: owner });
const noMembers = { isAdmin: false, isMember: async () => false };

describe("who can access a project", () => {
  it("opens a chain with no private project to anyone, even with no session", async () => {
    expect(await decideProjectAccess([PUBLIC], null, noMembers)).toBe(true);
  });

  it("denies a private project to an anonymous visitor", async () => {
    expect(await decideProjectAccess([privateNode("p")], null, noMembers)).toBe(false);
  });

  it("lets an admin into anything private", async () => {
    expect(await decideProjectAccess([privateNode("p")], "someone@acme.com", { isAdmin: true, isMember: async () => false })).toBe(true);
  });

  it("lets the owner in, case-insensitively", async () => {
    expect(await decideProjectAccess([privateNode("p", "Owner@Acme.com")], "owner@acme.com", noMembers)).toBe(true);
  });

  it("lets a member of an ancestor in: membership cascades down", async () => {
    const chain = [privateNode("child"), privateNode("parent")];
    const member = { isAdmin: false, isMember: async (id: string) => id === "parent" };
    expect(await decideProjectAccess(chain, "dev@acme.com", member)).toBe(true);
  });

  it("denies a stranger as soon as one ancestor is private", async () => {
    const chain: ProjectChainNode[] = [{ id: "child", visibility: "public", ownerEmail: null }, privateNode("parent")];
    expect(await decideProjectAccess(chain, "stranger@acme.com", noMembers)).toBe(false);
  });
});

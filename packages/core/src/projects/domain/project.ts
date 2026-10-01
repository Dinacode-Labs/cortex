import type { SessionUser } from "../../auth/session-user.js";

/**
 * The `Project` aggregate as the apps see it, plus the access policy that used to be tangled
 * with the recursive SQL that loads the ancestor chain (ADR-0076).
 */

export interface ProjectRef {
  id: string;
  name: string;
  slug: string | null;
  visibility: "public" | "private";
  ownerEmail: string | null;
  parentId: string | null;
}

/** One node of a project's ancestor chain, project included, enough to decide access. */
export interface ProjectChainNode {
  id: string;
  visibility: "public" | "private";
  ownerEmail: string | null;
}

/**
 * Can `viewer` access a project whose ancestor chain is `chain`? It cascades: if the project or
 * any ancestor is private the whole thing is restricted; access is granted by being an admin,
 * or owner/member of the project or of any ancestor (membership of the parent "Acme" opens its
 * sub-projects). Public everywhere -> open to anyone.
 */
export async function decideProjectAccess(
  chain: ProjectChainNode[],
  viewer: SessionUser | null,
  deps: { isAdmin: boolean; isMember: (projectId: string) => Promise<boolean> },
): Promise<boolean> {
  if (!chain.some((node) => node.visibility === "private")) return true;
  if (!viewer) return false;
  if (deps.isAdmin) return true;
  const e = viewer.email.toLowerCase();
  for (const node of chain) {
    if ((node.ownerEmail ?? "").toLowerCase() === e) return true;
    if (await deps.isMember(node.id)) return true;
  }
  return false;
}

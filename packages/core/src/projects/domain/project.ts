import { getEnv, language, type ContextEntryType, type Language, type ProjectCriteria, type TypeCriterion } from "@cortex/shared";
import type { SessionUser } from "../../auth/domain/session-user.js";

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

/** `chain` runs from the project up to its root: the nearest language set wins (ADR-0081). */
export function effectiveLanguage(chain: (Language | null)[], fallback: Language): Language {
  return chain.find((own): own is Language => own !== null) ?? fallback;
}

/** `chain` runs from the project up to its root: a child narrows what it inherits, never widens it (ADR-0084). */
export function effectiveCriteria(chain: (ProjectCriteria | null)[]): ProjectCriteria {
  const rootFirst = [...chain].reverse().filter((criteria): criteria is ProjectCriteria => criteria !== null);
  const types: ProjectCriteria["types"] = {};
  for (const criteria of rootFirst) {
    for (const [type, criterion] of Object.entries(criteria.types) as [ContextEntryType, TypeCriterion][]) {
      const before = types[type];
      const guidance = [before?.guidance, criterion.guidance].filter(Boolean).join("; ");
      types[type] = { keep: (before?.keep ?? true) && criterion.keep, ...(guidance ? { guidance } : {}) };
    }
  }
  const union = (lists: string[][]): string[] => [...new Set(lists.flat())];
  return { types, keep: union(rootFirst.map((c) => c.keep)), discard: union(rootFirst.map((c) => c.discard)) };
}

export function keepsType(criteria: ProjectCriteria, type: ContextEntryType): boolean {
  return criteria.types[type]?.keep ?? true;
}

let warnedLanguage = false;

export function defaultLanguage(): Language {
  const configured = getEnv("CORTEX_DEFAULT_LANGUAGE", "es");
  const parsed = language.safeParse(configured);
  if (parsed.success) return parsed.data;
  if (!warnedLanguage) {
    warnedLanguage = true;
    console.warn(`CORTEX_DEFAULT_LANGUAGE="${configured}" is not one of ${language.options.join(", ")}: using "es".`);
  }
  return "es";
}

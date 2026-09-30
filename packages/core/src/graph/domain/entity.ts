import { canonicalize } from "../../text.js";

/**
 * The rules of entity resolution (section 12.4), away from the SQL that applies them (ADR-0076).
 * An entity is a thing with a name; variants of the same name must converge on one canonical
 * node, and which one is canonical has to be reproducible.
 */

export interface EntityCandidate {
  id: string;
  name: string;
  linkCount: number;
}

/**
 * The key two entities share when they are variants of the same thing: TYPE + normalised name.
 * The type is part of the key on purpose -- the `vendor` "Stripe" and the `service` "Stripe"
 * are different things. A name normalising to fewer than three characters names nothing, so it
 * is not a group (returns null).
 */
export function entityGroupKey(type: string, name: string): string | null {
  const normalized = canonicalize(name).replace(/[^a-z0-9]+/g, "");
  if (normalized.length < 3) return null;
  return `${type}:${normalized}`;
}

/**
 * Ranks the variants of one entity so the canonical one comes first: most links, then the more
 * descriptive (longer) name and, still tied, the lower id -- without that last one the winner
 * would depend on the order Postgres happens to return rows in, and the merge would stop being
 * reproducible.
 */
export function rankEntities(candidates: EntityCandidate[]): EntityCandidate[] {
  return [...candidates].sort((a, b) => {
    if (b.linkCount !== a.linkCount) return b.linkCount - a.linkCount;
    if (b.name.length !== a.name.length) return b.name.length - a.name.length;
    return String(a.id).localeCompare(String(b.id));
  });
}

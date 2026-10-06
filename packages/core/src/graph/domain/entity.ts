import { z } from "zod";
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

export const entityType = z.enum([
  "client",
  "project",
  "repository",
  "module",
  "service",
  "technology",
  "person",
  "integration",
  "vendor",
]);
export type EntityType = z.infer<typeof entityType>;

export const extractableEntityType = z.enum(
  entityType.options.filter((t) => t !== "project") as [Exclude<EntityType, "project">, ...Exclude<EntityType, "project">[]],
);
export type ExtractableEntityType = z.infer<typeof extractableEntityType>;

export function isUsableEntityName(name: string): boolean {
  const n = name.trim();
  if (n.length < 3 || n.length > 60) return false;
  if (n.split(/\s+/).length > 6) return false;
  if (/[.;]$/.test(n) || n.includes(": ")) return false;
  // Spanish and English on purpose: these deictics match the corpus, not our source (ADR-0080).
  if (/^(la |el |una? )?(opci[oó]n|alternativa|caso|punto|paso|fase|v)\s*\d*[a-z]?$/i.test(n)) return false;
  if (/^(the |an? )?(option|alternative|case|point|step|phase)(\s+\d*[a-z]?|\d+)?$/i.test(n)) return false;
  return /[a-zA-Z]/.test(n);
}

export const entity = z.object({
  id: z.string().uuid(),
  name: z.string(),
  canonicalName: z.string(),
  type: entityType,
  metadata: z.record(z.unknown()),
  createdAt: z.date(),
  updatedAt: z.date(),
});
export type Entity = z.infer<typeof entity>;

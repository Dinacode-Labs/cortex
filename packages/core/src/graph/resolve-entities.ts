import { getSql } from "@cortex/database";
import { entityGroupKey, rankEntities } from "./domain/entity.js";
import { PgEntityRepository } from "./infrastructure/entity.repository.js";

/**
 * The entity resolution loop (section 12.4): merges variants of the same entity
 * (e.g. "Acme"/"Acme Corp"/"acme.com") into a canonical one, re-pointing links
 * (context_entry_entities) and relations, and deduplicating. Database only, no LLM.
 *
 * Which variants group and which one is canonical are rules of the `entity` domain
 * (`entityGroupKey`, `rankEntities`); the re-pointing SQL lives in the repository adapter.
 */

export interface ResolveResult {
  groups: number;
  merged: number;
}

export async function resolveEntities(): Promise<ResolveResult> {
  const repository = new PgEntityRepository(getSql());
  const entities = await repository.listResolvable();
  const linkCounts = await repository.linkCounts();

  const groups = new Map<string, { id: string; name: string }[]>();
  for (const e of entities) {
    const key = entityGroupKey(e.type, e.name);
    if (!key) continue;
    let bucket = groups.get(key);
    if (!bucket) {
      bucket = [];
      groups.set(key, bucket);
    }
    bucket.push({ id: e.id, name: e.name });
  }

  let merged = 0;
  let groupsMerged = 0;
  for (const [, group] of groups) {
    if (group.length < 2) continue;
    const ranked = rankEntities(group.map((e) => ({ id: e.id, name: e.name, linkCount: linkCounts.get(e.id) ?? 0 })));
    const canonical = ranked[0]!;
    const losers = ranked.slice(1);

    await repository.mergeEntities(canonical.id, losers.map((loser) => loser.id));
    merged += losers.length;
    groupsMerged++;
  }

  await repository.normalizeRelations();

  return { groups: groupsMerged, merged };
}

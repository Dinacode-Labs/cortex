import { port } from "../../composition.js";

/**
 * Bi-temporal invalidation (the Zep/Graphiti pattern): it closes the validity window of facts
 * that stopped being current, rather than deleting them. That way the graph keeps its history
 * and supports point-in-time queries.
 *
 * Two deterministic signals drive it: Plane's "Historico" state (migrated/legacy tasks) and
 * `supersedes` relations entry->entry. The SQL that acts on them lives in the repository
 * adapter. Idempotent: it only touches facts that are still current (valid_to IS NULL).
 */
export async function applyTemporalInvalidation(): Promise<{
  historical: number;
  superseded: number;
}> {
  const repository = port("memos");
  return {
    historical: await repository.closeHistoricalStates(),
    superseded: await repository.applySupersessions(),
  };
}

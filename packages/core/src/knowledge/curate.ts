import { getSql } from "@cortex/database";
import { getEnvNum } from "@cortex/shared";
import { PgMemoRepository } from "./infrastructure/memo.repository.js";

/**
 * Auto-curation with NO human in the loop (it replaces "review" so as not to add friction;
 * see research/memory-capture-policy.md). Over AUTO-captured knowledge
 * (`source_type = 'agent_session'`, low confidence -- the filter goes by origin, not by
 * author: authenticated capture signs with the user's email):
 *  - PROMOTES to medium confidence whatever was CORROBORATED: `metadata.corroborations`, the
 *    counter `recordCorroboration` raises when reconciliation meets the same knowledge again
 *    and decides there is nothing to add or folds it in.
 *  - DECAYS the old and never corroborated: auto-captured, zero corroborations, older than
 *    CORTEX_DECAY_DAYS -> status `obsolete` (it leaves search; reversible).
 * It never touches curated/validated knowledge, nor knowledge from other sources.
 *
 * It used to read `updated_at > created_at` as "it recurred in another session", and any write
 * at all satisfied that -- starting with `maintain`'s own reclassification pass, which ran
 * minutes earlier over the same entries. Confidence is earned by being confirmed, not by being
 * touched (ADR-0067).
 */
export interface CurationResult {
  promoted: number;
  decayed: number;
}

export async function autoCurate(decayDays = getEnvNum("CORTEX_DECAY_DAYS", 120)): Promise<CurationResult> {
  const repository = new PgMemoRepository(getSql());
  return {
    promoted: await repository.promoteCorroborated(),
    decayed: await repository.decayUncorroborated(decayDays),
  };
}

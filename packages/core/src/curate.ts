import { getSql } from "@cortex/database";
import { getEnvNum } from "@cortex/shared";
import type { Row } from "./map.js";

/**
 * Auto-curation with NO human in the loop (it replaces "review" so as not to add friction;
 * see research/memory-capture-policy.md). Over AUTO-captured knowledge
 * (`source_type = 'agent_session'`, low confidence -- the filter goes by origin, not by
 * author: authenticated capture signs with the user's email):
 *  - PROMOTES to medium confidence whatever was CORROBORATED: entries reinforced/merged
 *    AFTER being created (updated_at moved on -> it recurred in another session).
 *  - DECAYS the old and never corroborated: auto-captured, never merged, older than
 *    CORTEX_DECAY_DAYS -> status `obsolete` (it leaves search; reversible).
 * It never touches curated/validated knowledge, nor knowledge from other sources.
 */
export interface CurationResult {
  promoted: number;
  decayed: number;
}

export async function autoCurate(decayDays = getEnvNum("CORTEX_DECAY_DAYS", 120)): Promise<CurationResult> {
  const sql = getSql();
  const promoted = (await sql`
    UPDATE context_entries SET confidence = 'medium'
    WHERE confidence = 'low' AND source_type = 'agent_session'
      AND status = 'pending_validation' AND valid_to IS NULL
      AND updated_at > created_at + interval '1 minute'
    RETURNING id
  `) as unknown as Row[];
  const decayed = (await sql`
    UPDATE context_entries SET status = 'obsolete'
    WHERE confidence = 'low' AND source_type = 'agent_session'
      AND status = 'pending_validation' AND valid_to IS NULL
      AND updated_at <= created_at + interval '1 minute'
      AND created_at < now() - make_interval(days => ${decayDays})
    RETURNING id
  `) as unknown as Row[];
  return { promoted: promoted.length, decayed: decayed.length };
}

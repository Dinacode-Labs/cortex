-- Confidence is earned by corroboration, not by having been touched (ADR-0067).
--
-- `autoCurate` promoted to medium every auto-captured entry whose `updated_at` had moved past
-- `created_at`, on the assumption that only a merge moves it. It does not hold: `maintain`
-- reclassifies every entry the heuristics typed -- which is every distilled entry -- and it
-- rewrote them even when the classifier returned the type they already had. The trigger
-- `set_updated_at` moved `updated_at`, and in that same pass auto-curation read the movement as
-- "this recurred in another session". So the first maintenance run promoted practically
-- everything that had ever been distilled, and the decay branch, which only looks at entries
-- that were never touched, stopped firing at all.
--
-- This undoes those promotions. The counter it now goes by (`metadata.corroborations`) starts
-- empty, so entries that WERE genuinely corroborated come down too: they go back to low and
-- earn medium again the next time the same knowledge turns up. Confidence that was never
-- measured is worth less than confidence that is measured from today.
--
-- Nothing is deleted and `enrichedBy` is left as it is: what was reclassified was reclassified.
-- Only entries still under the machine's own judgement are touched (`pending_validation`):
-- whatever a person promoted, validated or rejected by hand is not a side effect to undo.

-- One definition of how the counter is read. `metadata` is free-form and clients write into it,
-- so a non-numeric `corroborations` would abort a whole maintenance run on a cast error.
CREATE OR REPLACE FUNCTION cortex_corroborations(meta jsonb) RETURNS int AS $$
  SELECT CASE WHEN jsonb_typeof(meta->'corroborations') = 'number'
              THEN (meta->>'corroborations')::int
              ELSE 0 END;
$$ LANGUAGE sql IMMUTABLE;

UPDATE context_entries
   SET confidence = 'low'
 WHERE source_type = 'agent_session'
   AND confidence = 'medium'
   AND status = 'pending_validation'
   AND valid_to IS NULL
   AND cortex_corroborations(metadata) = 0;

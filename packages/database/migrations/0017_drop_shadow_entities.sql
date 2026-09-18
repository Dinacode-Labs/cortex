-- Out with the shadow graph: entities that were copies of entries (ADR-0055).
--
-- `entities.type` accepted `decision` and `incident`, which are ENTRY types. The extractor
-- created them with the whole sentence as the name, so the same decision was stored twice:
-- once as an entry, with its content, its source and its validity, and once as a graph node
-- named "Publish Cortex openly and monetise the implementation (no hosting of our own)".
--
-- The damage was not the disk space, it was the noise in what people look at: those nodes
-- showed up as orphan entities, and contradictions were detected BETWEEN THEM -- in one real
-- installation all 18 `contradicts` relations were between entities and none between entries
-- -- with pairs as useless as "opcion C <-> opcion A". A health report that is half noise
-- teaches people not to look at the health report.
--
-- The nodes, their links to entries and their relations are deleted. **No entry is touched**:
-- the knowledge lives there and stays intact, with its bi-temporal history. What disappears is
-- the degraded copy. From now on the enum no longer accepts these types, so they do not come
-- back.

DELETE FROM relations r
 USING entities e
 WHERE (r.source_id = e.id OR r.target_id = e.id)
   AND e.type IN ('decision', 'incident');

DELETE FROM context_entry_entities cee
 USING entities e
 WHERE cee.entity_id = e.id
   AND e.type IN ('decision', 'incident');

DELETE FROM entities WHERE type IN ('decision', 'incident');

-- So they cannot come back even through hand-written SQL.
ALTER TABLE entities DROP CONSTRAINT IF EXISTS entities_type_not_entry_check;
ALTER TABLE entities ADD CONSTRAINT entities_type_not_entry_check
  CHECK (type NOT IN ('decision', 'incident'));

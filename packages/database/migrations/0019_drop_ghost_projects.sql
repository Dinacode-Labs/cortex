-- Out with the ghost projects: `project` entities nobody created (#135).
--
-- The classifier offered `project` among the entity types, so any proper noun the LLM read as a
-- project -- ticket codes, branches, files, microservices -- ended up in `entities` with
-- `type='project'`: the same row that represents a real project, but with no slug and no owner.
-- Since "project" meant "anything with type='project'", they showed up in `cortex link` and in
-- the UI mixed in with the real ones. In one real installation: 26 ghosts against 10 projects,
-- all of them with 0 entries.
--
-- Same pattern as 0017 (ADR-0055), with one difference: `project` IS a legitimate type, it is
-- the project's row. What tells a real project from a mention is the slug, which since 0016
-- every deliberately created project has. So:
--   1. `project` rows with no slug and nothing hanging off them (no entries, no children, no
--      members) are deleted along with their links and relations. No entry is touched.
--   2. Should one of them actually have something hanging off it -- it should not, but a
--      migration is no place for assumptions -- it is given a slug as 0016 did, not deleted.
--   3. A CHECK writes the invariant down: a `project` has a slug, or it is not a project.

CREATE TEMP TABLE ghosts AS
  SELECT e.id
    FROM entities e
   WHERE e.type = 'project'
     AND (e.slug IS NULL OR e.slug = '')
     AND NOT EXISTS (SELECT 1 FROM context_entries ce WHERE ce.project_id = e.id)
     AND NOT EXISTS (SELECT 1 FROM entities h WHERE h.parent_id = e.id)
     AND NOT EXISTS (SELECT 1 FROM project_members pm WHERE pm.project_id = e.id);

DELETE FROM relations r
 WHERE r.source_id IN (SELECT id FROM ghosts)
    OR r.target_id IN (SELECT id FROM ghosts);

DELETE FROM context_entry_entities cee
 WHERE cee.entity_id IN (SELECT id FROM ghosts);

DELETE FROM entities WHERE id IN (SELECT id FROM ghosts);

DROP TABLE ghosts;

-- Those that do have something hanging off them keep their row and get a slug (same rule as
-- 0016: the normalised name, with a stable id suffix when it collides).
WITH candidates AS (
  SELECT id,
         cortex_slugify(name) AS base,
         row_number() OVER (PARTITION BY cortex_slugify(name) ORDER BY id) AS n
  FROM entities
  WHERE type = 'project' AND (slug IS NULL OR slug = '')
)
UPDATE entities e
SET slug = CASE
             WHEN c.base = '' THEN 'project-' || left(replace(e.id::text, '-', ''), 8)
             WHEN c.n = 1 AND NOT EXISTS (SELECT 1 FROM entities x WHERE x.slug = c.base)
               THEN c.base
             ELSE c.base || '-' || left(replace(e.id::text, '-', ''), 6)
           END
FROM candidates c
WHERE e.id = c.id;

-- So they cannot come back even through hand-written SQL: a project has a slug, or it is not
-- a project.
ALTER TABLE entities DROP CONSTRAINT IF EXISTS entities_project_has_slug_check;
ALTER TABLE entities ADD CONSTRAINT entities_project_has_slug_check
  CHECK (type <> 'project' OR (slug IS NOT NULL AND slug <> ''));

-- A unique slug per project: the stable linking key (independent of git).
-- A repo is linked with `.cortex.json { "slug": "..." }`; Cortex resolves the slug to an
-- EXISTING project (the hooks never auto-create). See docs/decisions.md.

ALTER TABLE entities ADD COLUMN IF NOT EXISTS slug text;

-- Backfill: slugify the names of existing projects (CE Portal -> ce-portal).
UPDATE entities
SET slug = trim(both '-' from regexp_replace(lower(name), '[^a-z0-9]+', '-', 'g'))
WHERE type = 'project' AND (slug IS NULL OR slug = '');

-- Slug uniqueness across projects (partial: it only applies to type='project').
CREATE UNIQUE INDEX IF NOT EXISTS entities_project_slug_key
  ON entities (slug) WHERE type = 'project' AND slug IS NOT NULL;

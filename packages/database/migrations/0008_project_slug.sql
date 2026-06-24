-- Slug único por proyecto: clave estable de vinculación (independiente de git).
-- Un repo se vincula con `.cortex.json { "slug": "..." }`; Cortex resuelve el slug a un
-- proyecto EXISTENTE (no auto-crea desde los hooks). Ver docs/decisions.md.

ALTER TABLE entities ADD COLUMN IF NOT EXISTS slug text;

-- Backfill: slugify el nombre de los proyectos existentes (CE Portal → ce-portal).
UPDATE entities
SET slug = trim(both '-' from regexp_replace(lower(name), '[^a-z0-9]+', '-', 'g'))
WHERE type = 'project' AND (slug IS NULL OR slug = '');

-- Unicidad del slug entre proyectos (parcial: solo aplica a type='project').
CREATE UNIQUE INDEX IF NOT EXISTS entities_project_slug_key
  ON entities (slug) WHERE type = 'project' AND slug IS NOT NULL;

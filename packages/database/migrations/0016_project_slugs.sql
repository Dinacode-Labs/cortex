-- Every project has a slug (ADR-0051).
--
-- The slug is a project's address: what goes in `.cortex.json`, what the API receives and --
-- since ADR-0050 -- what its URL carries on the web. Until now only projects created with
-- `cortex link --create` had one: those born from a `save` ended up with no slug, no owner and
-- public, with no way to adopt or close them. The CLI already listed them as impossible to
-- link.
--
-- This fills in the missing ones from the name, with the same normalisation as `slugify`
-- (lowercase, accents stripped, non-alphanumerics to hyphens, no hyphens at the edges). When
-- two names collapse into the same slug, the second and later ones get a short, stable suffix
-- derived from the id: making up a `-2` would depend on the order they happen to be processed.

-- `unaccent` is an extension not every deployment has installed; for this it is enough to
-- translate the characters that actually show up in practice.
CREATE OR REPLACE FUNCTION cortex_slugify(value text) RETURNS text AS $$
  SELECT trim(both '-' from regexp_replace(
    lower(translate(value,
      'áàäâãåéèëêíìïîóòöôõúùüûñçÁÀÄÂÃÅÉÈËÊÍÌÏÎÓÒÖÔÕÚÙÜÛÑÇ',
      'aaaaaaeeeeiiiiooooouuuuncAAAAAAEEEEIIIIOOOOOUUUUNC')),
    '[^a-z0-9]+', '-', 'g'));
$$ LANGUAGE sql IMMUTABLE;

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

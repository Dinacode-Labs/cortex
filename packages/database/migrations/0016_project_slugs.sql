-- Todo proyecto tiene slug (ADR-0051).
--
-- El slug es la dirección de un proyecto: lo que va en `.cortex.json`, lo que la API recibe y
-- —desde ADR-0050— lo que lleva su URL en la web. Hasta ahora solo lo tenían los creados con
-- `cortex link --create`: los que nacían de un `save` se quedaban sin slug, sin dueño y
-- públicos, y no había forma de adoptarlos ni de cerrarlos. El CLI ya los listaba como
-- imposibles de vincular.
--
-- Esto rellena los que faltan a partir del nombre, con la misma normalización que `slugify`
-- (minúsculas, sin acentos, no alfanumérico a guiones, sin guiones al borde). Si dos nombres
-- colapsan en el mismo slug, el segundo y siguientes llevan un sufijo corto y estable derivado
-- del id: inventar `-2` dependería del orden en que se procesen.

-- `unaccent` es una extensión que no todos los despliegues tienen instalada; para esto basta
-- con traducir los caracteres que aparecen en la práctica.
CREATE OR REPLACE FUNCTION cortex_slugify(texto text) RETURNS text AS $$
  SELECT trim(both '-' from regexp_replace(
    lower(translate(texto,
      'áàäâãåéèëêíìïîóòöôõúùüûñçÁÀÄÂÃÅÉÈËÊÍÌÏÎÓÒÖÔÕÚÙÜÛÑÇ',
      'aaaaaaeeeeiiiiooooouuuuncAAAAAAEEEEIIIIOOOOOUUUUNC')),
    '[^a-z0-9]+', '-', 'g'));
$$ LANGUAGE sql IMMUTABLE;

WITH candidatos AS (
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
FROM candidatos c
WHERE e.id = c.id;

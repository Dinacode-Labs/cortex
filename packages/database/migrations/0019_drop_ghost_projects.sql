-- Fuera los proyectos fantasma: entidades `project` que nadie creó (#135).
--
-- El clasificador ofrecía `project` entre los tipos de entidad, así que cualquier nombre propio
-- que el LLM tomara por un proyecto —códigos de ticket, ramas, ficheros, microservicios— acababa
-- en `entities` con `type='project'`: la misma fila que representa a un proyecto de verdad, pero
-- sin slug ni dueño. Como «proyecto» era «todo lo que tenga type='project'», salían en
-- `cortex link` y en la UI mezclados con los reales. En una instalación real: 26 fantasmas
-- frente a 10 proyectos, todos con 0 entradas.
--
-- Mismo patrón que 0017 (ADR-0055), con una diferencia: `project` SÍ es un tipo legítimo, es la
-- fila del proyecto. Lo que distingue a un proyecto real de una mención es el slug, que desde
-- 0016 tiene todo proyecto creado a propósito. Así que:
--   1. Los `project` sin slug que no tienen nada colgando (ni entradas, ni hijos, ni miembros)
--      se borran con sus enlaces y relaciones. No se toca ninguna entrada.
--   2. Si alguno sí tuviera algo colgando —no debería, pero una migración no es sitio para
--      suponer— se le da slug como hizo 0016, en vez de borrarlo.
--   3. Un CHECK deja escrito el invariante: un `project` tiene slug, o no es un proyecto.

CREATE TEMP TABLE fantasmas AS
  SELECT e.id
    FROM entities e
   WHERE e.type = 'project'
     AND (e.slug IS NULL OR e.slug = '')
     AND NOT EXISTS (SELECT 1 FROM context_entries ce WHERE ce.project_id = e.id)
     AND NOT EXISTS (SELECT 1 FROM entities h WHERE h.parent_id = e.id)
     AND NOT EXISTS (SELECT 1 FROM project_members pm WHERE pm.project_id = e.id);

DELETE FROM relations r
 WHERE r.source_id IN (SELECT id FROM fantasmas)
    OR r.target_id IN (SELECT id FROM fantasmas);

DELETE FROM context_entry_entities cee
 WHERE cee.entity_id IN (SELECT id FROM fantasmas);

DELETE FROM entities WHERE id IN (SELECT id FROM fantasmas);

DROP TABLE fantasmas;

-- Los que sí tienen algo colgando conservan la fila y reciben slug (misma regla que 0016:
-- el nombre normalizado, con sufijo estable del id si colisiona).
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

-- Que no puedan volver ni por SQL a mano: un proyecto tiene slug, o no es un proyecto.
ALTER TABLE entities DROP CONSTRAINT IF EXISTS entities_project_has_slug_check;
ALTER TABLE entities ADD CONSTRAINT entities_project_has_slug_check
  CHECK (type <> 'project' OR (slug IS NOT NULL AND slug <> ''));

-- Hardening de integridad de BD (refactor D-5).
-- 1) Unicidad de aristas ACTIVAS del grafo: evita duplicados de relación vigente sin
--    impedir re-crear una arista tras invalidarla (modelo bi-temporal, §5.5).
-- 2) CHECK explícito de `visibility` en entities: solo 'public'/'private'.
-- Migración pensada para ser idempotente (IF NOT EXISTS / guardas DO) por robustez,
-- aunque el runner (schema_migrations) solo la aplica una vez.

-- ---------------------------------------------------------------------------
-- 1a) Dedupe previo de relaciones ACTIVAS duplicadas (por si las hubiera), para
-- que el índice UNIQUE pueda crearse. Conserva la de menor id (más antigua).
-- ---------------------------------------------------------------------------
DELETE FROM relations a USING relations b
WHERE a.id > b.id AND a.source_id = b.source_id AND a.target_id = b.target_id
  AND a.relation_type = b.relation_type
  AND a.valid_to IS NULL AND b.valid_to IS NULL;

-- ---------------------------------------------------------------------------
-- 1b) UNIQUE PARCIAL: unicidad SOLO sobre aristas vigentes (valid_to IS NULL).
-- Parcial a propósito: una arista invalidada (valid_to no nulo) puede coexistir
-- con su re-creación vigente sin colisionar (§5.5, invalidar ≠ borrar).
-- ---------------------------------------------------------------------------
CREATE UNIQUE INDEX IF NOT EXISTS relations_active_unique
  ON relations (source_id, target_id, relation_type)
  WHERE valid_to IS NULL;

-- ---------------------------------------------------------------------------
-- 2) CHECK de visibility en entities: solo 'public'/'private' (default 'public').
-- Idempotente: la recreamos si existiera para no fallar en re-ejecuciones.
-- ---------------------------------------------------------------------------
ALTER TABLE entities DROP CONSTRAINT IF EXISTS entities_visibility_check;
ALTER TABLE entities ADD CONSTRAINT entities_visibility_check
  CHECK (visibility IN ('public', 'private'));

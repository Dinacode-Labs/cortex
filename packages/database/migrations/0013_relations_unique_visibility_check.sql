-- Database integrity hardening (refactor D-5).
-- 1) Uniqueness of ACTIVE graph edges: prevents duplicates of a current relation without
--    blocking the re-creation of an edge after invalidating it (bi-temporal model, s5.5).
-- 2) An explicit `visibility` CHECK on entities: only 'public'/'private'.
-- The migration is written to be idempotent (IF NOT EXISTS / DO guards) for robustness,
-- even though the runner (schema_migrations) applies it only once.

-- ---------------------------------------------------------------------------
-- 1a) Up-front dedupe of duplicated ACTIVE relations (in case there are any), so the
-- UNIQUE index can be created. Keeps the lowest id (the oldest one).
-- ---------------------------------------------------------------------------
DELETE FROM relations a USING relations b
WHERE a.id > b.id AND a.source_id = b.source_id AND a.target_id = b.target_id
  AND a.relation_type = b.relation_type
  AND a.valid_to IS NULL AND b.valid_to IS NULL;

-- ---------------------------------------------------------------------------
-- 1b) PARTIAL UNIQUE: uniqueness ONLY over current edges (valid_to IS NULL).
-- Partial on purpose: an invalidated edge (non-null valid_to) can coexist with its current
-- re-creation without colliding (s5.5, invalidating is not deleting).
-- ---------------------------------------------------------------------------
CREATE UNIQUE INDEX IF NOT EXISTS relations_active_unique
  ON relations (source_id, target_id, relation_type)
  WHERE valid_to IS NULL;

-- ---------------------------------------------------------------------------
-- 2) visibility CHECK on entities: only 'public'/'private' (default 'public').
-- Idempotent: it is recreated if already present, so re-runs do not fail.
-- ---------------------------------------------------------------------------
ALTER TABLE entities DROP CONSTRAINT IF EXISTS entities_visibility_check;
ALTER TABLE entities ADD CONSTRAINT entities_visibility_check
  CHECK (visibility IN ('public', 'private'));

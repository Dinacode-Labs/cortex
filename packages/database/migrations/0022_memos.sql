-- A unit of knowledge is a memo, not a context entry (ADR-0077). The database says so too:
-- context_entries becomes memos, context_entry_entities becomes memo_entities, the
-- context_entry_id columns become memo_id, and the relations that point at a memo say 'memo'.
--
-- Renaming keeps every row, every foreign key and every index: Postgres follows the objects,
-- not their names. The names of the indexes, constraints and triggers that Postgres derived
-- from the old table are renamed by reading the catalog rather than by listing them, because
-- what an older database actually holds (an auto-generated, truncated name) is what counts.
--
-- Idempotent: every step checks for the old name first, so a second run is a no-op.

ALTER TABLE IF EXISTS context_entries RENAME TO memos;
ALTER TABLE IF EXISTS context_entry_entities RENAME TO memo_entities;

DO $$
DECLARE
  target record;
BEGIN
  FOR target IN
    SELECT table_name FROM information_schema.columns
     WHERE table_schema = current_schema() AND column_name = 'context_entry_id'
  LOOP
    EXECUTE format('ALTER TABLE %I RENAME COLUMN context_entry_id TO memo_id', target.table_name);
  END LOOP;
END $$;

CREATE OR REPLACE FUNCTION pg_temp.cortex_memo_name(old_name text) RETURNS text AS $$
  SELECT replace(replace(replace(old_name, 'context_entry_entities', 'memo_entities'),
                         'context_entries', 'memos'),
                 'context_entry', 'memo');
$$ LANGUAGE sql IMMUTABLE;

-- Constraints first: renaming a primary key or a unique constraint renames its index with it.
DO $$
DECLARE
  target record;
BEGIN
  FOR target IN
    SELECT c.conname, t.relname
      FROM pg_constraint c
      JOIN pg_class t ON t.oid = c.conrelid
      JOIN pg_namespace n ON n.oid = t.relnamespace
     WHERE n.nspname = current_schema() AND c.conname LIKE '%context\_entr%'
  LOOP
    EXECUTE format('ALTER TABLE %I RENAME CONSTRAINT %I TO %I',
                   target.relname, target.conname, pg_temp.cortex_memo_name(target.conname));
  END LOOP;

  FOR target IN
    SELECT indexname FROM pg_indexes
     WHERE schemaname = current_schema() AND indexname LIKE '%context\_entr%'
  LOOP
    EXECUTE format('ALTER INDEX %I RENAME TO %I',
                   target.indexname, pg_temp.cortex_memo_name(target.indexname));
  END LOOP;

  FOR target IN
    SELECT tg.tgname, t.relname
      FROM pg_trigger tg
      JOIN pg_class t ON t.oid = tg.tgrelid
      JOIN pg_namespace n ON n.oid = t.relnamespace
     WHERE n.nspname = current_schema() AND NOT tg.tgisinternal AND tg.tgname LIKE '%context\_entr%'
  LOOP
    EXECUTE format('ALTER TRIGGER %I ON %I RENAME TO %I',
                   target.tgname, target.relname, pg_temp.cortex_memo_name(target.tgname));
  END LOOP;
END $$;

-- `relations` points at either an entity or a memo, and says which in text.
UPDATE relations SET source_type = 'memo' WHERE source_type = 'context_entry';
UPDATE relations SET target_type = 'memo' WHERE target_type = 'context_entry';

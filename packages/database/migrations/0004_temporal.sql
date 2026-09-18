-- Bi-temporal graph (the Zep/Graphiti pattern): every fact/relation carries a validity
-- window. valid_to NULL = still current. observed_at = when the source asserted it.
-- created_at already acts as recorded_at (when the system ingested it).
-- Invalidating = closing the window (valid_to), never deleting -> point-in-time queries.

ALTER TABLE context_entries
  ADD COLUMN valid_from  timestamptz NOT NULL DEFAULT now(),
  ADD COLUMN valid_to    timestamptz,
  ADD COLUMN observed_at timestamptz NOT NULL DEFAULT now();

UPDATE context_entries SET valid_from = created_at, observed_at = created_at;
CREATE INDEX context_entries_valid_to_idx ON context_entries (valid_to);

ALTER TABLE relations
  ADD COLUMN valid_from  timestamptz NOT NULL DEFAULT now(),
  ADD COLUMN valid_to    timestamptz,
  ADD COLUMN observed_at timestamptz NOT NULL DEFAULT now();

UPDATE relations SET valid_from = created_at, observed_at = created_at;
CREATE INDEX relations_valid_to_idx ON relations (valid_to);

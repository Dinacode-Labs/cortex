CREATE TABLE IF NOT EXISTS entry_purges (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  entry_id          uuid NOT NULL,
  project_id        uuid REFERENCES entities(id) ON DELETE SET NULL,
  entry_type        text NOT NULL,
  entry_source_type text NOT NULL,
  entry_created_at  timestamptz NOT NULL,
  purged_by         text NOT NULL,
  purged_at         timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS entry_purges_project_idx ON entry_purges (project_id, purged_at DESC);

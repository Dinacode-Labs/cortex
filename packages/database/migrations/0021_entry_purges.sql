-- Who purged which entry, and when (ADR-0072).
--
-- Purging is the one operation in Cortex that destroys knowledge instead of closing its validity
-- window, so it leaves the smallest trace that still answers "where did entry X go?": the id,
-- the project, what kind of entry it was, who purged it and when. Deliberately NOT the title or
-- the content -- keeping those would make the purge a soft delete with extra steps, and the
-- reason to purge is usually that the text should not be read again.
--
-- No foreign key on `entry_id`: the row it names no longer exists, which is the point.
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

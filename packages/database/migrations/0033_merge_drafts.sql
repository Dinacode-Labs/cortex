-- The merge the consolidation agent drafts ahead for each review, so it waits for the person
-- (ADR-0096). Keyed by the memos it merges, sorted; `source_hash` is what they read when it was
-- drafted, and a NULL content is a draft that failed, not to be asked for again until they change.
-- Purging a memo deletes every draft that quotes it: an array cannot carry a foreign key.
CREATE TABLE IF NOT EXISTS merge_drafts (
  memo_ids     uuid[] PRIMARY KEY,
  project_id   uuid NOT NULL REFERENCES entities(id) ON DELETE CASCADE,
  source_hash  text NOT NULL,
  title        text,
  content      text,
  drafted_at   timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS merge_drafts_memo_ids_idx ON merge_drafts USING gin (memo_ids);

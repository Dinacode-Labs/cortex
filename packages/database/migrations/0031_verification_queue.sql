-- Every memo saved from here on, until a person says on the web whether it is right (ADR-0093).
-- Memos from before have no row, so the lane starts empty rather than with the whole backlog. A
-- memo leaves it through `memo_reviews`, the one record of verdicts: nothing here changes on one.
CREATE TABLE IF NOT EXISTS verification_queue (
  memo_id     uuid PRIMARY KEY REFERENCES memos(id) ON DELETE CASCADE,
  skipped_at  timestamptz,
  created_at  timestamptz NOT NULL DEFAULT now()
);

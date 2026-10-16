-- The older memos a person should look at again because something newer was saved about the same
-- thing (ADR-0091). The newer memo is taken as valid; whether the older one still holds is a
-- person's call, so nothing here changes a memo on its own.
CREATE TABLE IF NOT EXISTS review_queue (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id     uuid NOT NULL REFERENCES entities(id) ON DELETE CASCADE,
  memo_id        uuid NOT NULL REFERENCES memos(id) ON DELETE CASCADE,
  newer_memo_id  uuid NOT NULL REFERENCES memos(id) ON DELETE CASCADE,
  similarity     real NOT NULL,
  priority       real NOT NULL,
  status         text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'resolved')),
  resolution     text CHECK (resolution IN ('kept', 'discarded', 'modified')),
  resolved_by    text,
  resolved_at    timestamptz,
  skipped_at     timestamptz,
  created_at     timestamptz NOT NULL DEFAULT now(),
  UNIQUE (memo_id, newer_memo_id)
);

CREATE INDEX IF NOT EXISTS review_queue_pending_idx ON review_queue (project_id, memo_id) WHERE status = 'pending';

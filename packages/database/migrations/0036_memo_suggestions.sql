-- What the editing agent proposes, each night, for a memo nobody has checked yet (ADR-0099): a
-- rewrite or that it be rejected. Kept for the memo as it read then (`source_hash`): rewritten
-- since, and the suggestion no longer applies. A NULL `kind` is a memo looked at with nothing to
-- suggest, not to be asked about again until it changes.
CREATE TABLE IF NOT EXISTS memo_suggestions (
  memo_id       uuid PRIMARY KEY REFERENCES memos(id) ON DELETE CASCADE,
  project_id    uuid NOT NULL REFERENCES entities(id) ON DELETE CASCADE,
  source_hash   text NOT NULL,
  kind          text CHECK (kind IN ('rewrite', 'reject')),
  title         text,
  content       text,
  reason        text,
  suggested_at  timestamptz NOT NULL DEFAULT now()
);

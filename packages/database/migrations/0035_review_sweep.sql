-- The nightly second pass sets the day's memos against the whole project and raises, as one review,
-- each group a save missed (ADR-0098). A group is anchored on its oldest memo, one row per other
-- memo, so the Review section shows it as it shows any review of the older lane. `relation` and
-- `reason` are what the agent judged of the group; without a model both stay NULL.
ALTER TABLE review_queue ADD COLUMN IF NOT EXISTS raised_by text NOT NULL DEFAULT 'save'
  CHECK (raised_by IN ('save', 'sweep'));
ALTER TABLE review_queue ADD COLUMN IF NOT EXISTS relation text
  CHECK (relation IN ('duplicate', 'overlap', 'contradiction'));
ALTER TABLE review_queue ADD COLUMN IF NOT EXISTS reason text;

-- Up to when each project's memos were swept, so a night the worker missed is caught up the next.
CREATE TABLE IF NOT EXISTS review_sweeps (
  project_id   uuid PRIMARY KEY REFERENCES entities(id) ON DELETE CASCADE,
  swept_until  timestamptz NOT NULL,
  swept_at     timestamptz NOT NULL DEFAULT now()
);

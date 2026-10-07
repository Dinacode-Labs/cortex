-- What the last lint of each project found, so a project card can say whether it needs a look
-- without linting it on every page view (ADR-0089).
CREATE TABLE IF NOT EXISTS project_health (
  project_id     uuid PRIMARY KEY REFERENCES entities(id) ON DELETE CASCADE,
  contradictions integer NOT NULL,
  duplicates     integer NOT NULL,
  checked_at     timestamptz NOT NULL DEFAULT now()
);

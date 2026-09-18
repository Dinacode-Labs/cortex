-- Record of agent sessions already distilled (ADR-0025: distillation moves to the server).
--
-- It exists for IDEMPOTENCE, and the reason is economic as well as correct: the end-of-session
-- and pre-compaction hooks fire several times over the SAME session, and distilling is the
-- expensive part of the pipeline (one model call per transcript window). Without this table,
-- closing and reopening a session would pay twice for the same knowledge.
--
-- `condensed_chars` allows something better than "already done": if the session grew, only
-- the NEW tail is distilled. The condensed form is deterministic and append-only (earlier
-- turns do not change), so the already-processed prefix need not be looked at again.
CREATE TABLE IF NOT EXISTS session_captures (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id       uuid NOT NULL REFERENCES entities(id) ON DELETE CASCADE,
  platform         text NOT NULL,
  session_id       text NOT NULL,
  user_email       text NOT NULL,
  condensed_hash   text NOT NULL,
  condensed_chars  integer NOT NULL DEFAULT 0,
  status           text NOT NULL DEFAULT 'queued' CHECK (status IN ('queued','running','done','failed')),
  counters         jsonb NOT NULL DEFAULT '{}'::jsonb,
  error            text,
  created_at       timestamptz NOT NULL DEFAULT now(),
  updated_at       timestamptz NOT NULL DEFAULT now(),
  UNIQUE (project_id, platform, session_id)
);

-- For sweeping up stuck jobs (a server restarting mid-distillation leaves 'running' rows
-- that nobody is going to finish).
CREATE INDEX IF NOT EXISTS session_captures_status_idx ON session_captures (status, updated_at);

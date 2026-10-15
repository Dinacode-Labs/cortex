-- Every verdict given on a memo, by whom, from where and when (ADR-0090). A memo's `status` only
-- holds the last verdict: without this a validation could not say who gave it, a mistaken click
-- could not be traced, and a person's "yes, it holds" could not be told from an agent's.
CREATE TABLE IF NOT EXISTS memo_reviews (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  memo_id      uuid NOT NULL REFERENCES memos(id) ON DELETE CASCADE,
  verdict      text NOT NULL CHECK (verdict IN ('validated', 'rejected', 'obsolete')),
  channel      text NOT NULL CHECK (channel IN ('web', 'mcp')),
  -- NULL only from an MCP server over stdio, which has nobody signed in.
  reviewed_by  text,
  reviewed_at  timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS memo_reviews_memo_idx ON memo_reviews (memo_id, reviewed_at DESC);

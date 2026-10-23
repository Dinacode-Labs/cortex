-- The daily email about memos waiting in Review (ADR-0097). Off by default: a person gets it for
-- a project only once they switch it on there, so a project with no row here sends them nothing.
CREATE TABLE IF NOT EXISTS review_digest_subscriptions (
  project_id    uuid NOT NULL REFERENCES entities(id) ON DELETE CASCADE,
  user_id       uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  subscribed_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (project_id, user_id)
);

-- One digest a person a day, however many projects it covers: this is what the claim compares.
CREATE TABLE IF NOT EXISTS review_digest_sends (
  user_id      uuid PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  last_sent_at timestamptz NOT NULL
);

-- The link in each digest that turns one project off without signing in. Hashed like every other
-- secret, and short-lived because an email gets forwarded, and whoever reads it could turn it off.
CREATE TABLE IF NOT EXISTS unsubscribe_tokens (
  token_hash text PRIMARY KEY,
  user_id    uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  project_id uuid NOT NULL REFERENCES entities(id) ON DELETE CASCADE,
  expires_at timestamptz NOT NULL
);

CREATE INDEX IF NOT EXISTS unsubscribe_tokens_expiry_idx ON unsubscribe_tokens (expires_at);

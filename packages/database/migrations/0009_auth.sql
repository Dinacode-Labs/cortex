-- Email + OTP authentication (no passwords). A user IS their email address. The basis for
-- attribution (created_by = email) and permissions. See docs/decisions.md.

CREATE TABLE IF NOT EXISTS users (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  email         text UNIQUE NOT NULL,
  created_at    timestamptz NOT NULL DEFAULT now(),
  last_login_at timestamptz
);

-- Single-use OTP codes (hashed; never in clear text).
CREATE TABLE IF NOT EXISTS otp_codes (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  email       text NOT NULL,
  code_hash   text NOT NULL,
  expires_at  timestamptz NOT NULL,
  consumed_at timestamptz,
  attempts    int NOT NULL DEFAULT 0,
  created_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS otp_codes_email_idx ON otp_codes (email, created_at DESC);

-- Session tokens (hashed). Sent as Bearer on API requests.
CREATE TABLE IF NOT EXISTS auth_tokens (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  token_hash   text UNIQUE NOT NULL,
  user_id      uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at   timestamptz NOT NULL DEFAULT now(),
  expires_at   timestamptz NOT NULL,
  last_used_at timestamptz
);
CREATE INDEX IF NOT EXISTS auth_tokens_user_idx ON auth_tokens (user_id);

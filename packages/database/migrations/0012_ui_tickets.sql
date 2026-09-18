-- Single-use tickets for the `cortex ui` -> browser handshake. The (authenticated) CLI
-- asks for a short ticket; the web exchanges it for a session of its own. That way the
-- CLI's long-lived token never travels in the URL. See docs/decisions.md.
CREATE TABLE IF NOT EXISTS ui_tickets (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  ticket_hash text UNIQUE NOT NULL,
  user_id     uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  expires_at  timestamptz NOT NULL,
  used_at     timestamptz,
  created_at  timestamptz NOT NULL DEFAULT now()
);

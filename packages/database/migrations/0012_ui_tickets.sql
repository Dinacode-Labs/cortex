-- Tickets de un solo uso para el handshake `cortex ui` → navegador. El CLI (autenticado)
-- pide un ticket corto; la web lo canjea por una sesión propia. Así el token de larga
-- vida del CLI nunca viaja en la URL. Ver docs/decisions.md.
CREATE TABLE IF NOT EXISTS ui_tickets (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  ticket_hash text UNIQUE NOT NULL,
  user_id     uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  expires_at  timestamptz NOT NULL,
  used_at     timestamptz,
  created_at  timestamptz NOT NULL DEFAULT now()
);

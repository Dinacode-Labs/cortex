-- Registro de sesiones de agente ya destiladas (ADR-0025: la destilación pasa al servidor).
--
-- Existe por IDEMPOTENCIA, y el motivo es económico además de correcto: los hooks de fin de
-- sesión y de pre-compactación disparan varias veces sobre la MISMA sesión, y destilar es lo
-- caro del pipeline (una llamada al modelo por ventana de transcript). Sin esta tabla, cerrar
-- y reabrir una sesión pagaría dos veces por el mismo conocimiento.
--
-- `condensed_chars` permite algo mejor que "ya está hecha": si la sesión creció, se destila
-- SOLO la cola nueva. El condensado es determinista y append-only (los turnos anteriores no
-- cambian), así que el prefijo ya procesado no hace falta volver a mirarlo.
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

-- Para el barrido de trabajos encallados (un servidor que se reinicia a media destilación
-- deja filas en 'running' que nadie va a terminar).
CREATE INDEX IF NOT EXISTS session_captures_status_idx ON session_captures (status, updated_at);

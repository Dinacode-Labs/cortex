-- Visibilidad de proyectos + dueño + miembros (para privados). Por defecto PÚBLICO.
-- El admin (CORTEX_ADMIN_EMAIL) ve todos. Ver docs/decisions.md.

ALTER TABLE entities ADD COLUMN IF NOT EXISTS visibility text NOT NULL DEFAULT 'public';
ALTER TABLE entities ADD COLUMN IF NOT EXISTS owner_email text;

-- Miembros de un proyecto privado (además del dueño y los admin).
CREATE TABLE IF NOT EXISTS project_members (
  project_id uuid NOT NULL REFERENCES entities(id) ON DELETE CASCADE,
  email      text NOT NULL,
  added_at   timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (project_id, email)
);

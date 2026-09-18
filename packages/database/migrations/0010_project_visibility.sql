-- Project visibility + owner + members (for private ones). PUBLIC by default.
-- The admin (CORTEX_ADMIN_EMAIL) sees them all. See docs/decisions.md.

ALTER TABLE entities ADD COLUMN IF NOT EXISTS visibility text NOT NULL DEFAULT 'public';
ALTER TABLE entities ADD COLUMN IF NOT EXISTS owner_email text;

-- Members of a private project (on top of the owner and the admins).
CREATE TABLE IF NOT EXISTS project_members (
  project_id uuid NOT NULL REFERENCES entities(id) ON DELETE CASCADE,
  email      text NOT NULL,
  added_at   timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (project_id, email)
);

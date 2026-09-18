-- Project hierarchy: a project can have a PARENT (e.g. a client "Acme" with sub-projects
-- acme-api, acme-web). The parent's context is INHERITED into the sub-project's pack;
-- permissions cascade. See docs/decisions.md.

ALTER TABLE entities ADD COLUMN IF NOT EXISTS parent_id uuid REFERENCES entities(id) ON DELETE SET NULL;
CREATE INDEX IF NOT EXISTS entities_parent_idx ON entities (parent_id) WHERE parent_id IS NOT NULL;

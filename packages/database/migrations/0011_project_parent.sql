-- Jerarquía de proyectos: un proyecto puede tener un PADRE (p.ej. cliente "Boluda" con
-- subproyectos boluda-api, boluda-web). El contexto del padre se HEREDA en el pack del
-- subproyecto; los permisos cascadean. Ver docs/decisions.md.

ALTER TABLE entities ADD COLUMN IF NOT EXISTS parent_id uuid REFERENCES entities(id) ON DELETE SET NULL;
CREATE INDEX IF NOT EXISTS entities_parent_idx ON entities (parent_id) WHERE parent_id IS NOT NULL;

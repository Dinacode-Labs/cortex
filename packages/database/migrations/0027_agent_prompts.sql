-- What each agent role is told on top of its contract, at root and per project (ADR-0088).
CREATE TABLE IF NOT EXISTS agent_prompts (
  project_id uuid REFERENCES entities(id) ON DELETE CASCADE,
  role       text NOT NULL,
  prompt     text NOT NULL,
  updated_by text NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now()
);

-- Root is the NULL project, and it holds one prompt per role like any project does.
CREATE UNIQUE INDEX IF NOT EXISTS agent_prompts_project_role ON agent_prompts (project_id, role) NULLS NOT DISTINCT;

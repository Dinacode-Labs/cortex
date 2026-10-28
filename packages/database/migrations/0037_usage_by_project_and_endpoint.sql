-- Which project each call served and which host it went to (ADR-0100). The host is what tells two
-- subscriptions apart: a self-hosted model and a paid one both record `openai-compatible`. The old
-- `project` text column was declared in 0005 and never written by anything.
ALTER TABLE llm_usage ADD COLUMN IF NOT EXISTS project_id uuid REFERENCES entities(id) ON DELETE SET NULL;
ALTER TABLE llm_usage ADD COLUMN IF NOT EXISTS endpoint text;
ALTER TABLE llm_usage DROP COLUMN IF EXISTS project;

-- OpenRouter has one host, so its history can say where it went; any other provider's cannot.
UPDATE llm_usage SET endpoint = 'openrouter.ai' WHERE endpoint IS NULL AND provider = 'openrouter';

CREATE INDEX IF NOT EXISTS llm_usage_project_created_idx ON llm_usage (project_id, created_at);
CREATE INDEX IF NOT EXISTS llm_usage_endpoint_idx ON llm_usage (endpoint);

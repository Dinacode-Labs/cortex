-- The model an admin picks for an agent role from the web; it wins over the server's environment
-- (ADR-0101). `model` holds the same grammar as CORTEX_MODEL_<ROLE>: `model` or `provider:model`.
CREATE TABLE IF NOT EXISTS agent_models (
  role       text PRIMARY KEY,
  model      text NOT NULL,
  updated_by text NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now()
);

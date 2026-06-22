-- Observabilidad de coste/uso de IA (ADR-0016).
-- Registra cada llamada al LLM (Agents de Mastra) y a embeddings, con tokens y
-- una estimación de coste según una tabla de precios por modelo. nan = gratis (0).

CREATE TABLE llm_usage (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  created_at    timestamptz NOT NULL DEFAULT now(),
  kind          text NOT NULL DEFAULT 'llm',   -- 'llm' | 'embedding'
  provider      text NOT NULL,                 -- nan | openrouter | openai | voyage
  model         text NOT NULL,
  operation     text NOT NULL,                 -- classifier | graph | reranker | retriever | embedding | ...
  project       text,                          -- proyecto asociado (si se conoce)
  input_tokens  integer NOT NULL DEFAULT 0,
  output_tokens integer NOT NULL DEFAULT 0,
  total_tokens  integer NOT NULL DEFAULT 0,
  est_cost_usd  numeric(12,6) NOT NULL DEFAULT 0,
  duration_ms   integer
);

CREATE INDEX llm_usage_created_idx   ON llm_usage (created_at);
CREATE INDEX llm_usage_operation_idx ON llm_usage (operation);
CREATE INDEX llm_usage_kind_idx      ON llm_usage (kind);

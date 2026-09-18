-- AI cost/usage observability (ADR-0016).
-- Records every call to the LLM (Mastra Agents) and to embeddings, with tokens and an
-- estimated cost from a per-model price table. nan = free (0).

CREATE TABLE llm_usage (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  created_at    timestamptz NOT NULL DEFAULT now(),
  kind          text NOT NULL DEFAULT 'llm',   -- 'llm' | 'embedding'
  provider      text NOT NULL,                 -- nan | openrouter | openai | voyage
  model         text NOT NULL,
  operation     text NOT NULL,                 -- classifier | graph | reranker | retriever | embedding | ...
  project       text,                          -- associated project (when known)
  input_tokens  integer NOT NULL DEFAULT 0,
  output_tokens integer NOT NULL DEFAULT 0,
  total_tokens  integer NOT NULL DEFAULT 0,
  est_cost_usd  numeric(12,6) NOT NULL DEFAULT 0,
  duration_ms   integer
);

CREATE INDEX llm_usage_created_idx   ON llm_usage (created_at);
CREATE INDEX llm_usage_operation_idx ON llm_usage (operation);
CREATE INDEX llm_usage_kind_idx      ON llm_usage (kind);

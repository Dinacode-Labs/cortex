-- Observability B: AI traces (Mastra spans). Every Agent call produces a tree of spans
-- (agent_run -> model_generation -> model_inference...). We export them into this table
-- through our own exporter (see @cortex/agents trace-exporter).
-- It complements `llm_usage` (cost): what lives here is the span TREE with latency,
-- parent/child hierarchy, model and tokens. ADR-0016.

CREATE TABLE ai_traces (
  span_id        text PRIMARY KEY,
  trace_id       text NOT NULL,
  parent_span_id text,
  name           text,
  span_type      text,
  entity_name    text,         -- e.g. cortex-classifier / cortex-graph
  model          text,
  input_tokens   integer,
  output_tokens  integer,
  started_at     timestamptz,
  ended_at       timestamptz,
  duration_ms    integer,
  status         text,         -- ok | error
  attributes     jsonb,
  created_at     timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX ai_traces_trace_idx   ON ai_traces (trace_id);
CREATE INDEX ai_traces_started_idx ON ai_traces (started_at DESC);
CREATE INDEX ai_traces_type_idx    ON ai_traces (span_type);

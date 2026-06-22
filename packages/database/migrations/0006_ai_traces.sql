-- Observabilidad B: trazas de IA (spans de Mastra). Cada llamada a un Agent genera
-- un árbol de spans (agent_run → model_generation → model_inference…). Las
-- exportamos a esta tabla vía un exporter propio (ver @cortex/agents trace-exporter).
-- Complementa a `llm_usage` (coste): aquí está el ÁRBOL de spans con latencia,
-- jerarquía padre/hijo, modelo y tokens. ADR-0016.

CREATE TABLE ai_traces (
  span_id        text PRIMARY KEY,
  trace_id       text NOT NULL,
  parent_span_id text,
  name           text,
  span_type      text,
  entity_name    text,         -- p.ej. cortex-classifier / cortex-graph
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

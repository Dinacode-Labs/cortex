-- Búsqueda léxica (BM25-like) con Full-Text Search de Postgres, para combinar con
-- la búsqueda vectorial (híbrido + RRF). Config 'spanish' (stemming + stopwords ES).

ALTER TABLE context_entries
  ADD COLUMN content_tsv tsvector
  GENERATED ALWAYS AS (
    to_tsvector('spanish', coalesce(title, '') || ' ' || coalesce(content, ''))
  ) STORED;

CREATE INDEX context_entries_tsv_idx ON context_entries USING GIN (content_tsv);

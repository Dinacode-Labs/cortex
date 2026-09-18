-- Lexical search (BM25-like) with Postgres Full-Text Search, to combine with vector
-- search (hybrid + RRF). The 'spanish' configuration (stemming + ES stopwords) is chosen
-- to match the corpus being ingested, not the language of this repository.

ALTER TABLE context_entries
  ADD COLUMN content_tsv tsvector
  GENERATED ALWAYS AS (
    to_tsvector('spanish', coalesce(title, '') || ' ' || coalesce(content, ''))
  ) STORED;

CREATE INDEX context_entries_tsv_idx ON context_entries USING GIN (content_tsv);

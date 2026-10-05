ALTER TABLE memos ADD COLUMN IF NOT EXISTS language text NOT NULL DEFAULT 'es' CHECK (language IN ('es', 'en'));

-- Postgres 16 cannot change a generated column's expression in place, so it is rebuilt.
ALTER TABLE memos DROP COLUMN IF EXISTS content_tsv;
ALTER TABLE memos ADD COLUMN content_tsv tsvector GENERATED ALWAYS AS (
  to_tsvector(
    CASE language WHEN 'en' THEN 'english'::regconfig ELSE 'spanish'::regconfig END,
    coalesce(title, '') || ' ' || coalesce(content, '')
  )
) STORED;

CREATE INDEX IF NOT EXISTS memos_tsv_idx ON memos USING GIN (content_tsv);

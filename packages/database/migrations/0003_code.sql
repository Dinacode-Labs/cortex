-- Índice de CÓDIGO por proyecto/cliente. Chunks de los repos del cliente con
-- embedding (vectorial) + FTS ('simple', apto para identificadores de código).
-- Tabla separada de context_entries: distinta forma (ruta, rango de líneas) y
-- volumen (miles de chunks).

CREATE TABLE code_chunks (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id        uuid REFERENCES entities(id) ON DELETE CASCADE,
  repo              text NOT NULL,
  path              text NOT NULL,
  language          text,
  start_line        integer NOT NULL,
  end_line          integer NOT NULL,
  content           text NOT NULL,
  content_tsv       tsvector GENERATED ALWAYS AS (to_tsvector('simple', coalesce(content, ''))) STORED,
  embedding_model   text NOT NULL,
  dim               integer NOT NULL,
  embedding         vector NOT NULL,
  created_at        timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX code_chunks_project_idx ON code_chunks (project_id);
CREATE INDEX code_chunks_path_idx ON code_chunks (project_id, path);
CREATE INDEX code_chunks_tsv_idx ON code_chunks USING GIN (content_tsv);

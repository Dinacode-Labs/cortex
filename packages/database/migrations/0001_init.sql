-- Migración inicial de Cortex.
-- Modelo de datos del §14 del documento de planteamiento (hipótesis a validar).
-- Base única Postgres + pgvector: documental + vectorial + relacional (ADR-0003/4).

CREATE EXTENSION IF NOT EXISTS vector;

-- updated_at automático
CREATE OR REPLACE FUNCTION set_updated_at() RETURNS trigger AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- =====================================================================
-- sources: fuente original de una pieza de conocimiento (§14 sources)
-- =====================================================================
CREATE TABLE sources (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  source_type  text NOT NULL CHECK (source_type IN (
                 'manual','claude_code','github_pr','github_issue','jira_ticket',
                 'notion_doc','email','chat','meeting_transcript','codex')),
  external_id  text,
  url          text,
  raw_content  text,
  metadata     jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at   timestamptz NOT NULL DEFAULT now()
);

-- =====================================================================
-- entities: nodos del grafo relacional (§14 entities)
-- =====================================================================
CREATE TABLE entities (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name            text NOT NULL,
  canonical_name  text NOT NULL,
  type            text NOT NULL CHECK (type IN (
                    'client','project','repository','module','service','technology',
                    'person','integration','decision','incident','vendor')),
  metadata        jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now()
);
-- Una entidad canónica por (tipo, canonical_name): base para resolución de entidades.
CREATE UNIQUE INDEX entities_type_canonical_uniq ON entities (type, canonical_name);
CREATE INDEX entities_type_idx ON entities (type);

CREATE TRIGGER entities_set_updated_at
  BEFORE UPDATE ON entities
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- =====================================================================
-- context_entries: unidades de conocimiento (§14 context_entries)
-- =====================================================================
CREATE TABLE context_entries (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id        uuid REFERENCES entities(id) ON DELETE SET NULL,
  client_id         uuid REFERENCES entities(id) ON DELETE SET NULL,
  source_id         uuid REFERENCES sources(id) ON DELETE SET NULL,
  title             text NOT NULL,
  content           text NOT NULL,
  summary           text,
  type              text NOT NULL CHECK (type IN (
                      'decision','constraint','incident','architecture','module_note',
                      'technical_debt','convention','business_rule','integration_note',
                      'risk','how_to','meeting_summary','pr_summary','ticket_resolution')),
  status            text NOT NULL DEFAULT 'pending_validation' CHECK (status IN (
                      'draft','pending_validation','validated','rejected','obsolete','superseded')),
  confidence        text NOT NULL DEFAULT 'medium' CHECK (confidence IN (
                      'low','medium','high','verified')),
  validity          text NOT NULL DEFAULT 'current' CHECK (validity IN (
                      'current','historical','unknown')),
  source_type       text NOT NULL DEFAULT 'manual',
  source_reference  text,
  created_by        text,
  superseded_by     uuid REFERENCES context_entries(id) ON DELETE SET NULL,
  metadata          jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at        timestamptz NOT NULL DEFAULT now(),
  updated_at        timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX context_entries_project_idx ON context_entries (project_id);
CREATE INDEX context_entries_type_idx ON context_entries (type);
CREATE INDEX context_entries_status_idx ON context_entries (status);

CREATE TRIGGER context_entries_set_updated_at
  BEFORE UPDATE ON context_entries
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- =====================================================================
-- context_entry_entities: enlaza una entrada con las entidades que menciona
-- (§9.3). Base para expansión por relaciones en retrieval.
-- =====================================================================
CREATE TABLE context_entry_entities (
  context_entry_id  uuid NOT NULL REFERENCES context_entries(id) ON DELETE CASCADE,
  entity_id         uuid NOT NULL REFERENCES entities(id) ON DELETE CASCADE,
  PRIMARY KEY (context_entry_id, entity_id)
);
CREATE INDEX context_entry_entities_entity_idx ON context_entry_entities (entity_id);

-- =====================================================================
-- relations: aristas del grafo (§14 relations). Polimórficas: source/target
-- pueden ser entidades o entradas (de ahí source_type/target_type como texto).
-- =====================================================================
CREATE TABLE relations (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  source_id      uuid NOT NULL,
  source_type    text NOT NULL,
  target_id      uuid NOT NULL,
  target_type    text NOT NULL,
  relation_type  text NOT NULL CHECK (relation_type IN (
                   'belongs_to','affects','depends_on','contradicts','supersedes',
                   'related_to','implemented_by','discussed_in','caused_by','resolved_by')),
  confidence     text NOT NULL DEFAULT 'medium' CHECK (confidence IN (
                   'low','medium','high','verified')),
  metadata       jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at     timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX relations_source_idx ON relations (source_id);
CREATE INDEX relations_target_idx ON relations (target_id);

-- =====================================================================
-- embeddings: vectores por entrada (§14 embeddings). Dimensión variable según
-- el proveedor configurado (ADR-0005); por eso `vector` sin dimensión fija.
-- Para la demo hacemos búsqueda exacta (sin índice ivfflat/hnsw).
-- =====================================================================
CREATE TABLE embeddings (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  context_entry_id  uuid NOT NULL REFERENCES context_entries(id) ON DELETE CASCADE,
  embedding_model   text NOT NULL,
  embedding_version text NOT NULL,
  dim               integer NOT NULL,
  vector            vector NOT NULL,
  chunk_index       integer NOT NULL DEFAULT 0,
  created_at        timestamptz NOT NULL DEFAULT now(),
  UNIQUE (context_entry_id, embedding_model, embedding_version, chunk_index)
);
CREATE INDEX embeddings_entry_idx ON embeddings (context_entry_id);

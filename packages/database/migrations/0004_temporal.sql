-- Grafo bi-temporal (patrón Zep/Graphiti): cada hecho/relación lleva ventana de
-- validez. valid_to NULL = vigente. observed_at = cuándo lo afirmó la fuente.
-- created_at ya actúa como recorded_at (cuándo lo ingirió el sistema).
-- Invalidar = cerrar la ventana (valid_to), nunca borrar → consultas point-in-time.

ALTER TABLE context_entries
  ADD COLUMN valid_from  timestamptz NOT NULL DEFAULT now(),
  ADD COLUMN valid_to    timestamptz,
  ADD COLUMN observed_at timestamptz NOT NULL DEFAULT now();

UPDATE context_entries SET valid_from = created_at, observed_at = created_at;
CREATE INDEX context_entries_valid_to_idx ON context_entries (valid_to);

ALTER TABLE relations
  ADD COLUMN valid_from  timestamptz NOT NULL DEFAULT now(),
  ADD COLUMN valid_to    timestamptz,
  ADD COLUMN observed_at timestamptz NOT NULL DEFAULT now();

UPDATE relations SET valid_from = created_at, observed_at = created_at;
CREATE INDEX relations_valid_to_idx ON relations (valid_to);

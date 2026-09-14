-- Latido de los procesos sin puerto (el worker de mantenimiento).
--
-- El worker ya escribía un latido a un fichero, pero vive DENTRO de su contenedor: solo lo ve
-- su propio healthcheck de Docker. Desde fuera nadie sabe si sigue vivo, y es quien mantiene
-- la memoria (enriquecido, reconciliación, lint). Si muere en silencio, la memoria se degrada
-- despacio y nadie se entera hasta que alguien nota que algo no cuadra.
--
-- Una fila por proceso, sobrescrita en cada latido. No crece.
CREATE TABLE IF NOT EXISTS worker_heartbeats (
  name       text PRIMARY KEY,
  beat_at    timestamptz NOT NULL DEFAULT now()
);

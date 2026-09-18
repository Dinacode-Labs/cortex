-- Heartbeat for the processes with no port (the maintenance worker).
--
-- The worker already wrote a heartbeat to a file, but that file lives INSIDE its container:
-- only its own Docker healthcheck sees it. From outside nobody knows whether it is alive, and
-- it is what maintains the memory (enrichment, reconciliation, lint). If it dies silently, the
-- memory degrades slowly and nobody notices until someone spots that something is off.
--
-- One row per process, overwritten on every beat. It does not grow.
CREATE TABLE IF NOT EXISTS worker_heartbeats (
  name       text PRIMARY KEY,
  beat_at    timestamptz NOT NULL DEFAULT now()
);

import { writeFileSync } from "node:fs";
import { getSql } from "@cortex/database";
import cron from "node-cron";
import { runMaintenance, wireLlm } from "@cortex/agents";

/**
 * The maintenance worker: it runs the `runMaintenance` pipeline periodically (the loops of
 * section 12 -- enrich/resolve/temporal/lint). Meant to run on the server as a
 * process/service (docker-compose) or through the system's cron calling `maintain`.
 *
 * Usage: cortex-admin maintain-worker
 * Env: CORTEX_MAINTAIN_CRON (a cron expression; default "0 3 * * *" = 03:00 daily),
 *      CORTEX_MAINTAIN_ON_START=1 to run once at startup,
 *      CORTEX_WORKER_HEARTBEAT_FILE (the heartbeat file; default /tmp/cortex-worker.heartbeat).
 *
 * The heartbeat exists because this process listens on no port: without it, a hung worker (a
 * cron that never fires, a promise that never resolves) looks perfectly healthy from outside
 * and nobody finds out until someone misses a week's maintenance.
 */
export async function run(): Promise<void> {
  wireLlm();
  const heartbeatFile = process.env.CORTEX_WORKER_HEARTBEAT_FILE ?? "/tmp/cortex-worker.heartbeat";
  const beat = (): void => {
    try {
      writeFileSync(heartbeatFile, new Date().toISOString());
    } catch {
      /* if it cannot be written, the healthcheck will say so; that is no reason not to work */
    }
    // And to the database too: the file is only seen by THIS container's healthcheck. From
    // outside nobody would know the worker had died, and it is what keeps the memory alive.
    // Failing here must not stop the work either.
    void getSql()`
      INSERT INTO worker_heartbeats (name, beat_at) VALUES ('maintain', now())
      ON CONFLICT (name) DO UPDATE SET beat_at = now()
    `.catch(() => {});
  };
  const expr = process.env.CORTEX_MAINTAIN_CRON ?? "0 3 * * *";
  if (!cron.validate(expr)) {
    console.error(`Invalid CORTEX_MAINTAIN_CRON: "${expr}"`);
    process.exit(1);
  }
  let running = false;
  async function tick(): Promise<void> {
    if (running) { console.log("[worker] tick skipped (a previous run is still in progress)."); return; }
    running = true;
    try {
      await runMaintenance();
    } catch (e) {
      console.error("[worker] maintenance error:", (e as Error).message);
    } finally {
      running = false;
      beat();
    }
  }
  console.log(`[worker] maintenance scheduled: "${expr}". Waiting...`);
  beat();
  setInterval(beat, 30_000).unref();
  cron.schedule(expr, tick);
  if (process.env.CORTEX_MAINTAIN_ON_START === "1") void tick();
}

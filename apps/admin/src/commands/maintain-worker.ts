import { writeFileSync } from "node:fs";
import { getSql } from "@cortex/database";
import cron from "node-cron";
import { runMaintenance, wireLlm } from "@cortex/agents";

/**
 * Worker de mantenimiento: ejecuta el pipeline `runMaintenance` periódicamente
 * (loops §12 — enrich/resolve/temporal/lint). Pensado para correr en el server como
 * proceso/servicio (docker-compose) o vía cron del sistema llamando a `maintain`.
 *
 * Uso: cortex-admin maintain-worker
 * Env: CORTEX_MAINTAIN_CRON (cron expr; def "0 3 * * *" = 3:00 cada día),
 *      CORTEX_MAINTAIN_ON_START=1 para ejecutar una vez al arrancar,
 *      CORTEX_WORKER_HEARTBEAT_FILE (fichero de latido; def /tmp/cortex-worker.heartbeat).
 *
 * El latido existe porque este proceso no escucha en ningún puerto: sin él, un worker
 * colgado (cron que no dispara, promesa que nunca resuelve) parece perfectamente sano desde
 * fuera y nadie se entera hasta que alguien echa en falta el mantenimiento de una semana.
 */
export async function run(): Promise<void> {
  wireLlm();
  const heartbeatFile = process.env.CORTEX_WORKER_HEARTBEAT_FILE ?? "/tmp/cortex-worker.heartbeat";
  const beat = (): void => {
    try {
      writeFileSync(heartbeatFile, new Date().toISOString());
    } catch {
      /* si no se puede escribir, el healthcheck lo dirá; no es motivo para no trabajar */
    }
    // Y también a la base: el fichero solo lo ve el healthcheck de ESTE contenedor. Desde
    // fuera nadie sabría que el worker ha muerto, y es quien mantiene la memoria viva.
    // Fallar aquí tampoco puede parar el trabajo.
    void getSql()`
      INSERT INTO worker_heartbeats (name, beat_at) VALUES ('maintain', now())
      ON CONFLICT (name) DO UPDATE SET beat_at = now()
    `.catch(() => {});
  };
  const expr = process.env.CORTEX_MAINTAIN_CRON ?? "0 3 * * *";
  if (!cron.validate(expr)) {
    console.error(`CORTEX_MAINTAIN_CRON inválido: "${expr}"`);
    process.exit(1);
  }
  let running = false;
  async function tick(): Promise<void> {
    if (running) { console.log("[worker] tick saltado (ejecución previa en curso)."); return; }
    running = true;
    try {
      await runMaintenance();
    } catch (e) {
      console.error("[worker] error en mantenimiento:", (e as Error).message);
    } finally {
      running = false;
      beat();
    }
  }
  console.log(`[worker] mantenimiento programado: "${expr}". Esperando…`);
  beat();
  setInterval(beat, 30_000).unref();
  cron.schedule(expr, tick);
  if (process.env.CORTEX_MAINTAIN_ON_START === "1") void tick();
}

import cron from "node-cron";
import { runMaintenance } from "./maintain.js";

/**
 * Worker de mantenimiento: ejecuta el pipeline `runMaintenance` periódicamente
 * (loops §12 — enrich/resolve/temporal/lint). Pensado para correr en el server como
 * proceso/servicio (docker-compose) o vía cron del sistema llamando a `maintain`.
 *
 * Uso: tsx src/maintain-worker.ts
 * Env: CORTEX_MAINTAIN_CRON (cron expr; def "0 3 * * *" = 3:00 cada día),
 *      CORTEX_MAINTAIN_ON_START=1 para ejecutar una vez al arrancar.
 */
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
  }
}

console.log(`[worker] mantenimiento programado: "${expr}". Esperando…`);
cron.schedule(expr, tick);
if (process.env.CORTEX_MAINTAIN_ON_START === "1") void tick();

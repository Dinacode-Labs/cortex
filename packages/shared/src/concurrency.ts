import { getEnvNum } from "./env.js";

/**
 * Semáforo en proceso para las llamadas al proveedor de inferencia (chat, visión, STT y
 * embeddings comparten cupo porque comparten API key).
 *
 * Por qué existe: los clusters con cuota limitan peticiones EN PARALELO por clave, no solo
 * por minuto — NaN admite 5 concurrentes y 60 rpm. Sin esto, un `maintain` o una ingesta
 * con concurrencia 8 dispara 429 en ráfaga y el backoff acaba costando más tiempo del que
 * ahorró el paralelismo. `CORTEX_LLM_CONCURRENCY` (def. 4) deja margen para que la visión o
 * el STT quepan a la vez sin tocar el techo.
 *
 * Es un límite POR PROCESO, no distribuido: varios workers a la vez siguen pudiendo
 * superarlo (para eso está el backoff de cada cliente).
 */

let inFlight = 0;
const waiters: (() => void)[] = [];

function limit(): number {
  const n = getEnvNum("CORTEX_LLM_CONCURRENCY", 4);
  return n >= 1 ? Math.floor(n) : 1;
}

async function acquire(): Promise<void> {
  if (inFlight < limit()) {
    inFlight++;
    return;
  }
  // El slot se HEREDA de quien libera (no se incrementa aquí): así dos `acquire`
  // simultáneos no pueden colarse en el hueco entre el release y el despertar.
  await new Promise<void>((resolve) => waiters.push(resolve));
}

function release(): void {
  const next = waiters.shift();
  if (next) {
    next(); // cede el slot sin decrementar
    return;
  }
  inFlight--;
}

/** Ejecuta `fn` ocupando un slot del proveedor de inferencia. */
export async function withLlmSlot<T>(fn: () => Promise<T>): Promise<T> {
  await acquire();
  try {
    return await fn();
  } finally {
    release();
  }
}

/** Llamadas en vuelo ahora mismo (solo para tests y diagnóstico). */
export function llmSlotsInFlight(): number {
  return inFlight;
}

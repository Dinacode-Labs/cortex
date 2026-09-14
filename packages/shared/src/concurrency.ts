import { getEnvNum } from "./env.js";

/**
 * Semáforo para las llamadas al proveedor de inferencia. Chat, visión, transcripción y
 * embeddings comparten cupo porque comparten clave, y los proveedores suelen limitar por
 * clave y no por tipo de endpoint.
 *
 * **Por qué existe:** muchos proveedores limitan peticiones EN PARALELO, además de por
 * minuto. Sin esto, una tarea de mantenimiento o una ingesta lanzando ocho a la vez dispara
 * 429 en ráfaga, y el backoff acaba costando más tiempo del que ahorró el paralelismo.
 * Cuál es el número de cada proveedor no se documenta aquí: es configuración del operador
 * (ADR-0031), y va en `CORTEX_LLM_CONCURRENCY`.
 *
 * **ES UN LÍMITE POR PROCESO.** Eso importa más de lo que parece: un despliegue típico
 * corre varios procesos que llaman al modelo —la API, el worker de mantenimiento, el MCP,
 * la web—, y cada uno tiene su propio contador. El techo real contra la clave es
 * `procesos × CORTEX_LLM_CONCURRENCY`, no el valor a secas. Quien lo configure tiene que
 * hacer esa división; está explicado en `.env.example` y en `deploy/README.md`.
 *
 * Un límite compartido de verdad exige estado compartido —y `shared` no puede depender de la
 * base de datos—, así que tendría que inyectarse desde los entrypoints, como el clasificador
 * o el reranker. Está anotado en el roadmap. Mientras no exista, lo que absorbe el exceso es
 * el reintento con backoff que ya tiene cada cliente.
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

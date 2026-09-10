/**
 * Cola en memoria para las destilaciones de sesión.
 *
 * Destilar es caro y lento (varias llamadas al modelo por sesión), así que el endpoint
 * responde `202` y el trabajo se hace por detrás. La concurrencia se limita porque el
 * proveedor de inferencia acota peticiones por clave: sin cola, diez devs cerrando sesión a
 * la vez producirían una ráfaga de 429 y el backoff acabaría costando más que hacerlo en
 * fila.
 *
 * Es una cola **de proceso**, no persistente: si el servidor cae, lo encolado se pierde.
 * Se asume a conciencia para no meter una tabla de trabajos y un worker en esta fase; el
 * daño está acotado porque los hooks vuelven a mandar la sesión la próxima vez y
 * `session_captures` marca como fallidos los trabajos que quedaron a medias.
 */

export interface CaptureQueue<T> {
  /** Encola y devuelve una promesa que resuelve cuando ESE trabajo termina. */
  enqueue(job: T): Promise<void>;
  /** Trabajos pendientes de empezar (sin contar los que están corriendo). */
  size(): number;
  inFlight(): number;
}

export function createCaptureQueue<T>(opts: {
  concurrency: number;
  run: (job: T) => Promise<void>;
}): CaptureQueue<T> {
  const limit = Math.max(1, Math.floor(opts.concurrency));
  const pending: { job: T; resolve: () => void }[] = [];
  let running = 0;

  function pump(): void {
    while (running < limit && pending.length > 0) {
      const next = pending.shift()!;
      running++;
      void opts
        .run(next.job)
        .catch((e: unknown) => {
          // `run` ya registra el fallo en la BD; aquí solo evitamos un unhandled rejection
          // que tumbaría el proceso.
          console.error("[capture-queue] trabajo fallido:", (e as Error).message);
        })
        .finally(() => {
          running--;
          next.resolve();
          pump();
        });
    }
  }

  return {
    enqueue(job) {
      return new Promise<void>((resolve) => {
        pending.push({ job, resolve });
        pump();
      });
    },
    size: () => pending.length,
    inFlight: () => running,
  };
}

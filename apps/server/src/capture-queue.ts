/**
 * Distilling is expensive and slow (several model calls per session), so the endpoint answers
 * `202` and the work happens behind it. Concurrency is capped because the inference provider
 * limits requests per key: with no queue, ten devs closing a session at once would produce a
 * burst of 429s and the backoff would end up costing more than doing them in a line.
 *
 * It is a **per-process** queue, not a persistent one: if the server goes down, what is queued
 * is lost. That is accepted deliberately so as not to add a jobs table and a worker at this
 * stage; the damage is bounded because the hooks send the session again next time and
 * `session_captures` marks half-finished jobs as failed.
 */

export interface CaptureQueue<T> {
  /** Enqueues, and returns a promise that resolves when THAT job finishes. */
  enqueue(job: T): Promise<void>;
  /** Jobs still waiting to start (not counting those already running). */
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
          // `run` already records the failure in the database; here we only avoid an
          // unhandled rejection that would bring the process down.
          console.error("[capture-queue] job failed:", (e as Error).message);
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

import { getEnvNum } from "./env.js";

/**
 * Semaphore for calls to the inference provider. Chat, vision, transcription and embeddings
 * share the same budget because they share the same key, and providers usually rate-limit
 * per key rather than per endpoint type.
 *
 * **Why it exists:** many providers cap requests IN PARALLEL, on top of per-minute quotas.
 * Without this, a maintenance job or an ingest firing eight at once triggers a burst of
 * 429s, and the backoff ends up costing more time than the parallelism saved. Each
 * provider's number is not documented here: that is operator configuration (ADR-0031), and
 * it goes in `CORTEX_LLM_CONCURRENCY`.
 *
 * **THIS IS A PER-PROCESS LIMIT.** That matters more than it looks: a typical deployment
 * runs several processes that call the model -- the API, the maintenance worker, the MCP,
 * the web -- and each keeps its own counter. The real ceiling against the key is
 * `processes x CORTEX_LLM_CONCURRENCY`, not the bare value. Whoever configures it has to do
 * that division; it is spelled out in `.env.example` and in `deploy/README.md`.
 *
 * A genuinely shared limit needs shared state -- and `shared` cannot depend on the database
 * -- so it would have to be injected from the entrypoints, like the classifier or the
 * reranker. It is noted in the roadmap. Until it exists, what absorbs the overflow is the
 * retry-with-backoff each client already has.
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
  // The slot is INHERITED from whoever releases it (it is not incremented here): that way
  // two simultaneous `acquire`s cannot slip into the gap between the release and the wake-up.
  await new Promise<void>((resolve) => waiters.push(resolve));
}

function release(): void {
  const next = waiters.shift();
  if (next) {
    next(); // hands the slot over without decrementing
    return;
  }
  inFlight--;
}

export async function withLlmSlot<T>(fn: () => Promise<T>): Promise<T> {
  await acquire();
  try {
    return await fn();
  } finally {
    release();
  }
}

/** Calls in flight right now (tests and diagnostics only). */
export function llmSlotsInFlight(): number {
  return inFlight;
}

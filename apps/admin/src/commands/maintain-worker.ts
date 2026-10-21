import { writeFileSync } from "node:fs";
import { getSql } from "@cortex/database";
import cron from "node-cron";
import { draftMergesAhead, pruneMergeDrafts, sendReviewDigests, validateEmailConfig } from "@cortex/core";
import { runMaintenance, wireLlm } from "@cortex/agents";

const MERGE_DRAFT_EVERY_MS = 60_000;

/**
 * The scheduled worker: it runs the `runMaintenance` pipeline periodically (the loops of
 * section 12 -- enrich/resolve/temporal/lint), drafts the merges Review proposes (ADR-0096) and
 * sends the review digest (ADR-0097). Meant to run on the server as a process/service
 * (docker-compose) or through the system's cron calling `maintain` and `review-digest`.
 *
 * Usage: cortex-admin maintain-worker
 * Env: CORTEX_MAINTAIN_CRON (a cron expression; default "0 3 * * *" = 03:00 daily),
 *      CORTEX_MERGE_DRAFTS_AHEAD (reviews per lane whose merge is drafted ahead, every minute; 0 = none),
 *      CORTEX_MAINTAIN_ON_START=1 to run once at startup,
 *      CORTEX_REVIEW_DIGEST_CRON (default "0 9 * * *"; empty turns the digest off),
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
  const maintain = oneAtATime("maintenance", async () => void (await runMaintenance()), beat);
  // Every minute rather than with the nightly run: a review raised now should find its merge
  // drafted by the time a person opens it (ADR-0096).
  let drafting = false;
  async function draftMerges(): Promise<void> {
    if (drafting) return;
    drafting = true;
    try {
      await pruneMergeDrafts();
      const drafted = await draftMergesAhead();
      if (drafted) console.log(`[worker] ${drafted} merge(s) drafted ahead for Review`);
    } catch (e) {
      console.error("[worker] merge drafting error:", (e as Error).message);
    } finally {
      drafting = false;
    }
  }
  console.log(`[worker] maintenance scheduled: "${expr}". Waiting...`);
  beat();
  setInterval(beat, 30_000).unref();
  setInterval(() => void draftMerges(), MERGE_DRAFT_EVERY_MS).unref();
  void draftMerges();
  cron.schedule(expr, maintain);
  scheduleReviewDigest(beat);
  if (process.env.CORTEX_MAINTAIN_ON_START === "1") void maintain();
}

function scheduleReviewDigest(beat: () => void): void {
  const expr = (process.env.CORTEX_REVIEW_DIGEST_CRON ?? "0 9 * * *").trim();
  if (!expr) {
    console.log("[worker] review digest off (CORTEX_REVIEW_DIGEST_CRON is empty).");
    return;
  }
  if (!cron.validate(expr)) {
    console.error(`Invalid CORTEX_REVIEW_DIGEST_CRON: "${expr}"`);
    process.exit(1);
  }
  // A broken email setup turns the digest off, not the worker: maintenance does not need email.
  try {
    for (const warning of validateEmailConfig()) console.warn(warning);
  } catch (e) {
    console.error(`[worker] review digest off: ${(e as Error).message}`);
    return;
  }
  const digest = oneAtATime("review digest", async () => {
    const run = await sendReviewDigests();
    console.log(`[digest] ${run.sent.length} sent, ${run.failed.length} failed.`);
    for (const failure of run.failed) console.error(`  [digest] ${failure.email}: ${failure.error}`);
  }, beat);
  console.log(`[worker] review digest scheduled: "${expr}".`);
  cron.schedule(expr, digest);
}

function oneAtATime(name: string, job: () => Promise<void>, afterEach: () => void): () => Promise<void> {
  let running = false;
  return async () => {
    if (running) { console.log(`[worker] ${name} skipped (a previous run is still in progress).`); return; }
    running = true;
    try {
      await job();
    } catch (e) {
      console.error(`[worker] ${name} error:`, (e as Error).message);
    } finally {
      running = false;
      afterEach();
    }
  };
}

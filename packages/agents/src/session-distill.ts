import { scrub, type CaptureSessionCounters, type SourceType } from "@cortex/shared";
import { sliceTranscript } from "@cortex/client";
import { saveWithReconciliation } from "@cortex/core";
import { distill } from "./distill.js";

/**
 * Distillation of an agent session **on the server** (ADR-0025).
 *
 * This used to run on every dev's laptop: the hook read the transcript, called the model with
 * the key from the cloned repo's `.env` and then posted each piece over HTTP. That forced LLM
 * credentials to be handed out to the whole team and put N clients hammering the provider in
 * parallel. The client now only sends the condensed transcript and the server -- which already
 * holds the credentials and controls concurrency -- does the expensive work.
 *
 * Being inside the server, it stores with `saveWithReconciliation` directly rather than going
 * the long way round through the API.
 */

export interface DistillSessionInput {
  /** The project's name (what `saveContext` expects). */
  projectName: string;
  /** The already-condensed transcript. It is scrubbed again here: the client is not trusted. */
  condensed: string;
  platform: string;
  sessionId: string;
  /** The authenticated email: the attribution for everything this session produces. */
  createdBy: string;
  sourceType?: SourceType;
}

export type DistillSessionFn = (input: DistillSessionInput) => Promise<CaptureSessionCounters>;

/** Below this there is no conversation to get anything useful out of. */
const MIN_CHARS = 200;

export const distillSession: DistillSessionFn = async (input) => {
  const counters: CaptureSessionCounters = { saved: 0, updated: 0, superseded: 0, noop: 0, failed: 0, windows: 0 };
  // Last line of defence: the client scrubs, but anyone can call the API.
  const condensed = scrub(input.condensed);
  if (condensed.length < MIN_CHARS) return counters;

  const sourceType = input.sourceType ?? "agent_session";
  const sourceReference = `${input.platform}:${input.sessionId}`;
  const seen = new Set<string>();

  const { windows, dropped } = sliceTranscript(condensed);
  if (dropped > 0) {
    // Make it visible: a trimmed session used to end up `done` just like one that fitted whole.
    counters.droppedChars = dropped;
    console.warn(
      `[session-distill] ${sourceReference}: ${dropped} characters left out of the distillation ` +
        `(${windows.length} windows spread across the session). ` +
        `Raise CORTEX_SESSIONS_MAX_WINDOWS to cover it whole.`,
    );
  }

  for (const window of windows) {
    counters.windows++;
    let items: Awaited<ReturnType<typeof distill>>;
    try {
      items = await distill(input.projectName, window);
    } catch (e) {
      // A window that fails (timeout, 429 after the retries) must not bring the whole session
      // down: it is counted and the rest carry on.
      counters.failed++;
      console.error(`[session-distill] window failed (${sourceReference}):`, (e as Error).message);
      continue;
    }

    for (const item of items) {
      // Cheap dedup within the session itself: the same subject usually recurs across windows
      // and there is no point paying for reconciliation to find that out.
      const key = item.title.toLowerCase().replace(/[^a-z0-9]+/g, "");
      if (key.length < 3 || seen.has(key)) continue;
      seen.add(key);

      try {
        const res = await saveWithReconciliation(
          {
            content: scrub(`${item.title}\n\n${item.content}`),
            project: input.projectName,
            title: item.title,
            summary: item.summary,
            type: item.type,
            confidence: "low", // distilled knowledge is born low-confidence; `maintain` raises it once corroborated
            sourceType,
            sourceReference,
            createdBy: input.createdBy,
            // `distiller`: a model already chose this type with the whole session window in
            // front of it, so `maintain`'s reclassification leaves it alone (ADR-0067).
            metadata: { platform: input.platform, sessionId: input.sessionId, enrichedBy: "distiller" },
          } as never,
          { useClassifier: false, detectImprovements: false },
        );
        if (res.action === "add") counters.saved++;
        else if (res.action === "update") counters.updated++;
        else if (res.action === "supersede" || res.action === "contradict") counters.superseded++;
        else counters.noop++;
      } catch (e) {
        counters.failed++;
        console.error(`[session-distill] failed to store "${item.title}":`, (e as Error).message);
      }
    }
  }

  return counters;
};

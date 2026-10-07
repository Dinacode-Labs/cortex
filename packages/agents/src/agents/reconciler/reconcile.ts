import { runAgent } from "../../runtime/run-agent.js";
import { reconcilerPrompt } from "./prompt.js";

/**
 * The decision half of the LLM reconciler. `core` receives both this and the merger through
 * `setReconciler` (wired in `wiring.ts`). Both session ingestion and the HTTP server
 * (authenticated captures) use it to do real ADD/UPDATE/SUPERSEDE/NOOP, not just deterministic
 * dedup.
 */
export async function reconcile(
  existing: string,
  incoming: string,
  context: { projectId: string | null },
): Promise<"noop" | "update" | "supersede"> {
  try {
    const prompt = reconcilerPrompt(existing, incoming);
    const raw = await runAgent("reconciler", prompt, { maxOutputTokens: 60, projectId: context.projectId });
    const m = raw.match(/noop|update|supersede/i);
    // When the LLM answers nothing recognisable, do NOT touch what exists: a failure (timeout,
    // truncated response) must not rewrite knowledge through a merge.
    return (m ? m[0].toLowerCase() : "noop") as "noop" | "update" | "supersede";
  } catch {
    return "noop";
  }
}

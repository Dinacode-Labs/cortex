import { runAgent } from "../../runtime/run-agent.js";

/**
 * The decision half of the LLM reconciler. `core` receives both this and the merger through
 * `setReconciler` (wired in `wiring.ts`). Both session ingestion and the HTTP server
 * (authenticated captures) use it to do real ADD/UPDATE/SUPERSEDE/NOOP, not just deterministic
 * dedup.
 */
export async function reconcile(existing: string, incoming: string): Promise<"noop" | "update" | "supersede"> {
  const prompt = `EXISTING:\n"""\n${existing}\n"""\n\nNEW:\n"""\n${incoming}\n"""\n\nWhat is the NEW one's relationship to the EXISTING one?`;
  try {
    const raw = await runAgent("reconciler", prompt, { maxOutputTokens: 60 });
    const m = raw.match(/noop|update|supersede/i);
    // When the LLM answers nothing recognisable, do NOT touch what exists: a failure (timeout,
    // truncated response) must not rewrite knowledge through a merge.
    return (m ? m[0].toLowerCase() : "noop") as "noop" | "update" | "supersede";
  } catch {
    return "noop";
  }
}

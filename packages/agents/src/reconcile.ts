import { setReconciler } from "@cortex/core";
import { runAgent } from "./mastra.js";

/**
 * The LLM reconciler (merge + decision) that core injects through setReconciler. Both session
 * ingestion and the HTTP server (authenticated captures) use it to do real
 * ADD/UPDATE/SUPERSEDE/NOOP, not just deterministic dedup.
 */
async function mergeKnowledge(existing: string, incoming: string): Promise<string> {
  const prompt = `Existing entry:\n"""\n${existing}\n"""\n\nNew information about the same thing:\n"""\n${incoming}\n"""\n\nMerge them into ONE consolidated entry.`;
  const merged = (await runAgent("merger", prompt, { maxOutputTokens: 700 })).trim();
  return merged || existing;
}

async function reconcile(existing: string, incoming: string): Promise<"noop" | "update" | "supersede"> {
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

let wired = false;
/** Injects the LLM reconciler into core (idempotent). */
export function wireReconciler(): void {
  if (wired) return;
  setReconciler({ decide: reconcile, merge: mergeKnowledge });
  wired = true;
}

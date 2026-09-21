import { contextEntryType } from "@cortex/shared";
import { runAgent } from "./mastra.js";
// Shared extractJson: on top of the brace trimming (distill's previous behaviour) it now
// understands ```json fenced blocks -- a strict improvement, not a regression: the fence is a
// superset of the simple trimming we used to do here.
import { extractJson } from "./llm-json.js";

/**
 * LLM distillation of a session transcript window into TYPED knowledge
 * (decisions/constraints/incidents/conventions...). It does not ingest the raw transcript: it
 * extracts only what is DURABLE and reusable, discarding noise. It is the "intelligent" part
 * of the session capture pipeline.
 *
 * Each item also carries its own `summary`. Without it the entry was summarised by the
 * heuristic over "Title. Body", so the summary of a 300-character distilled entry repeated
 * almost all of it, and that is what the pack hands the agent when a session opens.
 */

const TYPES = contextEntryType.options as readonly string[];

export interface Item { type: string; title: string; content: string; summary?: string }

/**
 * Is the provider rejecting us? This is told apart from a per-window failure because it is NOT
 * recoverable: with a bad key, every window of every session will fail the same way.
 *
 * It matters because swallowing this silently leaves capture producing zero forever while the
 * counters say everything is fine. It happened on a deploy: a wrong key returned
 * `saved: 0, failed: 0`, which is indistinguishable from "this session had nothing in it".
 */
function isProviderRejection(e: unknown): boolean {
  const err = e as { statusCode?: unknown; status?: unknown; message?: unknown };
  if (err?.statusCode === 401 || err?.statusCode === 403 || err?.status === 401 || err?.status === 403) return true;
  return /invalid api key|unauthorized|\b401\b|\b403\b/i.test(String(err?.message ?? e ?? ""));
}

export async function distill(project: string, window: string): Promise<Item[]> {
  const prompt = `Project: "${project}". A transcript window from an AI agent session working on this project:
"""
${window}
"""
Extract ONLY the DURABLE, reusable knowledge as JSON:
{"items":[{"type": one of [${TYPES.join(", ")}], "title": "a short title", "content": "the knowledge in 1-3 sentences", "summary": "one sentence that does NOT repeat the title"}]}
Include technical decisions, constraints, incidents and how they were resolved, conventions, technical debt, risks and how-tos. DISCARD noise (tool calls, file dumps, narration, greetings, abandoned attempts). NEVER include secrets or keys. When nothing is worth keeping, return {"items":[]}.`;
  try {
    const raw = await runAgent("distiller", prompt, { maxOutputTokens: 1500 });
    const parsed = JSON.parse(extractJson(raw)) as { items?: { type?: string; title?: string; content?: string; summary?: string }[] };
    return (parsed.items ?? [])
      .filter((i): i is Item => Boolean(i?.title && i?.content))
      .map((i) => ({
        type: TYPES.includes(i.type ?? "") ? (i.type as string) : "module_note",
        title: i.title.trim().slice(0, 160),
        content: i.content.trim(),
        summary: i.summary?.trim() || undefined,
      }));
  } catch (e) {
    // With no LLM configured there is no failure: that is a deliberate state and core falls
    // back to heuristics.
    if (isProviderRejection(e)) {
      throw new Error(`the inference provider is rejecting the key: ${(e as Error).message}`);
    }
    console.error(`  ✗ distillation failed on one window: ${(e as Error).message}`);
    return [];
  }
}

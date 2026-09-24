import type { SearchHit } from "@cortex/core";
import { getAgent } from "../../runtime/registry.js";
import { runAgent } from "../../runtime/run-agent.js";
import { rerankerPrompt } from "./prompt.js";

/**
 * Second-stage LLM reranker. It reorders the hybrid retrieval's candidates by relevance to the
 * question. The chat model is used because a dedicated reranker gave unreliable results (see
 * ADR-0009). Implemented as a Mastra Agent (role "reranker"). On any failure it leaves the
 * hits as they were.
 */
export async function rerankLLM(query: string, hits: SearchHit[]): Promise<SearchHit[]> {
  if (!getAgent("reranker") || hits.length <= 1) return hits;

  try {
    const raw = await runAgent("reranker", rerankerPrompt(query, hits), { maxOutputTokens: 300 });
    const s = raw.indexOf("{");
    const e = raw.lastIndexOf("}");
    const parsed = JSON.parse(s >= 0 && e > s ? raw.slice(s, e + 1) : raw) as { order?: number[] };
    const order = parsed.order;
    if (!Array.isArray(order) || order.length === 0) return hits;

    const seen = new Set<number>();
    const reordered: SearchHit[] = [];
    for (const idx of order) {
      if (Number.isInteger(idx) && idx >= 0 && idx < hits.length && !seen.has(idx)) {
        seen.add(idx);
        reordered.push(hits[idx]!);
      }
    }
    hits.forEach((h, i) => {
      if (!seen.has(i)) reordered.push(h);
    });
    return reordered;
  } catch (err) {
    console.error("[agents] rerankLLM failed:", (err as Error).message);
    return hits;
  }
}

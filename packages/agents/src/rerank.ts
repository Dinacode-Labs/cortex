import type { SearchHit } from "@cortex/core";
import { getAgent, runAgent } from "./mastra.js";

/**
 * Second-stage LLM reranker. It reorders the hybrid retrieval's candidates by relevance to the
 * question. The chat model is used because a dedicated reranker gave unreliable results (see
 * ADR-0009). Implemented as a Mastra Agent (role "reranker"). On any failure it leaves the
 * hits as they were.
 */
export async function rerankLLM(query: string, hits: SearchHit[]): Promise<SearchHit[]> {
  if (!getAgent("reranker") || hits.length <= 1) return hits;

  const list = hits
    .map((h, i) => `[${i}] (${h.entry.type}) ${h.entry.title}: ${(h.entry.summary ?? h.entry.content).slice(0, 200)}`)
    .join("\n");
  const prompt = `Question: "${query}"

Candidate fragments:
${list}

Order the indices from MOST to LEAST relevant for answering the question. Include only the
ones that contribute something. Return ONLY JSON: {"order":[indices]}.`;

  try {
    const raw = await runAgent("reranker", prompt, { maxOutputTokens: 300 });
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

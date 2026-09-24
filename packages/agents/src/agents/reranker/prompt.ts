import type { SearchHit } from "@cortex/core";

export function rerankerPrompt(query: string, hits: SearchHit[]): string {
  const list = hits
    .map((h, i) => `[${i}] (${h.entry.type}) ${h.entry.title}: ${(h.entry.summary ?? h.entry.content).slice(0, 200)}`)
    .join("\n");
  return `Question: "${query}"

Candidate fragments:
${list}

Order the indices from MOST to LEAST relevant for answering the question. Include only the
ones that contribute something. Return ONLY JSON: {"order":[indices]}.`;
}

import type { SearchHit } from "@cortex/core";

export function rerankerPrompt(query: string, hits: SearchHit[]): string {
  const list = hits
    .map((h, i) => `[${i}] (${h.entry.type}) ${h.entry.title}: ${(h.entry.summary ?? h.entry.content).slice(0, 200)}`)
    .join("\n");
  return `Question: "${query}"

Candidate fragments:
${list}

Return ONLY JSON with the indices in order: {"order":[indices]}.`;
}

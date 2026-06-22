import type { SearchHit } from "@cortex/core";
import { getAgent, runAgent } from "./mastra.js";

/**
 * Reranker de 2ª etapa con LLM (qwen3.6 vía nan). Reordena los candidatos del
 * retrieval híbrido por relevancia a la pregunta. Usamos el modelo de chat porque
 * el reranker dedicado de nan dio resultados poco fiables (ver ADR-0009).
 * Implementado como Agent de Mastra (rol "reranker"). Ante cualquier fallo, deja
 * los hits como estaban.
 */
export async function rerankLLM(query: string, hits: SearchHit[]): Promise<SearchHit[]> {
  if (!getAgent("reranker") || hits.length <= 1) return hits;

  const list = hits
    .map((h, i) => `[${i}] (${h.entry.type}) ${h.entry.title}: ${(h.entry.summary ?? h.entry.content).slice(0, 200)}`)
    .join("\n");
  const prompt = `Pregunta: "${query}"

Fragmentos candidatos:
${list}

Ordena los índices de MÁS a MENOS relevante para responder la pregunta. Incluye solo
los que aporten algo. Devuelve SOLO JSON: {"order":[índices]}.`;

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
    // Añade los no mencionados al final (preservando orden original).
    hits.forEach((h, i) => {
      if (!seen.has(i)) reordered.push(h);
    });
    return reordered;
  } catch (err) {
    console.error("[agents] rerankLLM falló:", (err as Error).message);
    return hits;
  }
}

/**
 * Embedding usage sink (cost observability, ADR-0016). The embeddings package is a leaf (it
 * does not depend on core/database); to avoid coupling, it exposes a sink that the consumer
 * (core) injects to record tokens. If nobody injects one, nothing happens.
 */
export interface EmbeddingUsage {
  model: string;
  totalTokens: number;
  count: number;
}

type Sink = (u: EmbeddingUsage) => void;
let sink: Sink | null = null;

export function setEmbeddingUsageSink(s: Sink | null): void {
  sink = s;
}

export function reportEmbeddingUsage(u: EmbeddingUsage): void {
  try {
    sink?.(u);
  } catch {
    /* observability never breaks the embedding */
  }
}

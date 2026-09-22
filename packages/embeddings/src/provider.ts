/**
 * Embedding provider interface (ADR-0005). Pluggable implementations:
 * local (the default, no keys), openai, voyage.
 */
export interface EmbeddingProvider {
  readonly model: string;
  /** Embedding schema version (so things can be reindexed when it changes). */
  readonly version: string;
  readonly dim: number;
  /** Produces one embedding per text, in the same order. */
  embed(texts: string[]): Promise<number[][]>;
}

export function l2normalize(vec: number[]): number[] {
  let sum = 0;
  for (const v of vec) sum += v * v;
  const norm = Math.sqrt(sum);
  if (norm === 0) return vec;
  return vec.map((v) => v / norm);
}

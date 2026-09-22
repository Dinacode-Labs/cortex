import { type EmbeddingProvider, l2normalize } from "./provider.js";

/**
 * Deterministic local provider, with NO keys (ADR-0005). It uses "feature hashing":
 * it tokenises the text and accumulates each token (with a sign) into a bucket of `dim`
 * positions, then L2-normalises.
 *
 * This is not a semantic embedding: it captures lexical overlap, not meaning. It exists to
 * demonstrate the vector-search wiring without depending on an external provider. For real
 * relevance, set EMBEDDINGS_PROVIDER=openai|voyage.
 */
export class LocalEmbeddingProvider implements EmbeddingProvider {
  readonly model = "local-feature-hash";
  readonly version = "1";
  readonly dim: number;

  constructor(dim = 256) {
    this.dim = dim;
  }

  async embed(texts: string[]): Promise<number[][]> {
    return texts.map((t) => this.embedOne(t));
  }

  private embedOne(text: string): number[] {
    const vec = new Array<number>(this.dim).fill(0);
    for (const token of tokenize(text)) {
      const h = fnv1a(token);
      const bucket = h % this.dim;
      // top bit of the hash as the sign, to reduce collision bias
      const sign = (h & 0x80000000) === 0 ? 1 : -1;
      vec[bucket] = (vec[bucket] ?? 0) + sign;
    }
    return l2normalize(vec);
  }
}

function tokenize(text: string): string[] {
  return text
    .toLowerCase()
    .split(/[^\p{L}\p{N}]+/u)
    .filter((t) => t.length > 1);
}

function fnv1a(str: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

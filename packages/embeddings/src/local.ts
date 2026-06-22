import { type EmbeddingProvider, l2normalize } from "./provider.js";

/**
 * Proveedor local determinista, SIN claves (ADR-0005). Usa "feature hashing":
 * tokeniza el texto y acumula cada token (con signo) en un bucket de `dim`
 * posiciones, luego normaliza L2.
 *
 * No es un embedding semántico: captura solape léxico, no significado. Sirve para
 * demostrar el cableado de la búsqueda vectorial sin depender de un proveedor
 * externo. Para relevancia real, configura EMBEDDINGS_PROVIDER=openai|voyage.
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
      // bit alto del hash como signo, para reducir el sesgo de colisiones
      const sign = (h & 0x80000000) === 0 ? 1 : -1;
      vec[bucket] = (vec[bucket] ?? 0) + sign;
    }
    return l2normalize(vec);
  }
}

/** Tokeniza: minúsculas, separa por no-alfanuméricos (unicode), descarta vacíos. */
function tokenize(text: string): string[] {
  return text
    .toLowerCase()
    .split(/[^\p{L}\p{N}]+/u)
    .filter((t) => t.length > 1);
}

/** FNV-1a 32-bit. Determinista y rápido; suficiente para feature hashing. */
function fnv1a(str: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

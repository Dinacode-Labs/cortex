/**
 * Interfaz de proveedor de embeddings (ADR-0005). Implementaciones enchufables:
 * local (por defecto, sin claves), openai, voyage.
 */
export interface EmbeddingProvider {
  /** Identificador del modelo, se persiste con cada vector. */
  readonly model: string;
  /** Versión del esquema de embedding (para reindexar si cambia). */
  readonly version: string;
  /** Dimensión de los vectores que produce. */
  readonly dim: number;
  /** Genera un embedding por cada texto, en el mismo orden. */
  embed(texts: string[]): Promise<number[][]>;
}

/** Normaliza un vector a norma L2 = 1 (para similitud coseno estable). */
export function l2normalize(vec: number[]): number[] {
  let sum = 0;
  for (const v of vec) sum += v * v;
  const norm = Math.sqrt(sum);
  if (norm === 0) return vec;
  return vec.map((v) => v / norm);
}

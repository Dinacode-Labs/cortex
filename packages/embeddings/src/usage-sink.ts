/**
 * Sink de uso de embeddings (observabilidad de coste, ADR-0016). El paquete
 * embeddings es una hoja (no depende de core/database); para no acoplar, expone un
 * sink que el consumidor (core) inyecta para registrar tokens. Si nadie lo inyecta,
 * no pasa nada.
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
    /* la observabilidad nunca rompe el embedding */
  }
}

import { getEnv, requireEnv } from "@cortex/shared";
import { LocalEmbeddingProvider } from "./local.js";
import { type EmbeddingProvider } from "./provider.js";
import { OpenAICompatibleEmbeddingProvider } from "./remote.js";

export { type EmbeddingProvider, l2normalize } from "./provider.js";
export { LocalEmbeddingProvider } from "./local.js";
export { OpenAICompatibleEmbeddingProvider } from "./remote.js";
export { setEmbeddingUsageSink, type EmbeddingUsage } from "./usage-sink.js";

let cached: EmbeddingProvider | undefined;

/** Descarta el singleton. Solo para tests: en producción la config no cambia en caliente
 *  y recrear el proveedor a mitad de una ingesta mezclaría dimensiones. */
export function resetEmbeddingProvider(): void {
  cached = undefined;
}

let warnedNanAlias = false;

/** Lee la dimensión declarada y falla pronto si no es utilizable: la dimensión define el
 *  esquema vectorial, y un valor inválido no se detectaría hasta el primer INSERT. */
function requireDim(raw: string): number {
  const dim = Number(raw);
  if (!Number.isInteger(dim) || dim <= 0) {
    throw new Error(`EMBEDDINGS_DIM debe ser un entero positivo (recibido: "${raw}").`);
  }
  return dim;
}

/**
 * Devuelve el proveedor de embeddings configurado vía EMBEDDINGS_PROVIDER
 * (local | openai-compatible | openai | voyage). Por defecto "local" para arrancar sin
 * claves. Singleton perezoso.
 */
export function getEmbeddingProvider(): EmbeddingProvider {
  if (cached) return cached;
  // `|| "local"`: una variable declarada pero vacía cuenta como "sin configurar" y debe
  // caer al default, no reventar el arranque con "proveedor desconocido: ''".
  const provider = (getEnv("EMBEDDINGS_PROVIDER", "local").trim() || "local").toLowerCase();
  switch (provider) {
    case "openai":
      // Modelo/dim configurables (ADR-0023). Default text-embedding-3-large (3072-dim,
      // buen multilingüe); baja a text-embedding-3-small (1536) por coste con
      // OPENAI_EMBEDDING_MODEL/OPENAI_EMBEDDING_DIM.
      cached = new OpenAICompatibleEmbeddingProvider({
        apiKey: requireEnv("OPENAI_API_KEY"),
        baseURL: "https://api.openai.com/v1",
        model: getEnv("OPENAI_EMBEDDING_MODEL", "text-embedding-3-large"),
        dim: Number(getEnv("OPENAI_EMBEDDING_DIM", "3072")),
      });
      break;
    case "nan": {
      // ALIAS OBSOLETO de openai-compatible con los defaults de NaN. Se retira en v0.2.0.
      if (!warnedNanAlias) {
        warnedNanAlias = true;
        console.warn(
          "[embeddings] EMBEDDINGS_PROVIDER=nan is deprecated: use openai-compatible with " +
            "EMBEDDINGS_BASE_URL / EMBEDDINGS_API_KEY / EMBEDDINGS_MODEL / EMBEDDINGS_DIM " +
            "(see .env.example). The alias is removed in v0.2.0.",
        );
      }
      cached = new OpenAICompatibleEmbeddingProvider({
        apiKey: getEnv("EMBEDDINGS_API_KEY", "").trim() || requireEnv("NAN_API_KEY"),
        baseURL: getEnv("EMBEDDINGS_BASE_URL", "").trim() || process.env.NAN_BASE_URL || "https://api.nan.builders/v1",
        model: getEnv("EMBEDDINGS_MODEL", "").trim() || process.env.NAN_EMBEDDING_MODEL || "qwen3-embedding",
        dim: requireDim(getEnv("EMBEDDINGS_DIM", "").trim() || process.env.NAN_EMBEDDING_DIM || "4096"),
      });
      break;
    }
    case "openai-compatible": {
      // Cualquier endpoint que sirva /v1/embeddings: NaN, Ollama, vLLM, TEI, LM Studio.
      // La dimensión es OBLIGATORIA: no se puede adivinar y define el esquema vectorial.
      const apiKey = getEnv("EMBEDDINGS_API_KEY", "").trim();
      cached = new OpenAICompatibleEmbeddingProvider({
        apiKey: apiKey || (getEnv("EMBEDDINGS_ALLOW_NO_KEY", "").trim() ? "no-key" : requireEnv("EMBEDDINGS_API_KEY")),
        baseURL: requireEnv("EMBEDDINGS_BASE_URL"),
        model: requireEnv("EMBEDDINGS_MODEL"),
        dim: requireDim(requireEnv("EMBEDDINGS_DIM")),
      });
      break;
    }
    case "voyage":
      // Voyage es OpenAI-compatible para embeddings: reutilizamos el mismo cliente
      // (con reintentos y reporte de uso unificado). Mismo env var y mismo fallo si falta.
      cached = new OpenAICompatibleEmbeddingProvider({
        apiKey: requireEnv("VOYAGE_API_KEY"),
        baseURL: "https://api.voyageai.com/v1",
        model: "voyage-3",
        dim: 1024,
      });
      break;
    case "local":
      cached = new LocalEmbeddingProvider();
      break;
    default:
      throw new Error(
        `EMBEDDINGS_PROVIDER desconocido: "${provider}". Usa local | openai-compatible | openai | voyage.`,
      );
  }
  return cached;
}

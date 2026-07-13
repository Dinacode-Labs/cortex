import { getEnv, requireEnv } from "@cortex/shared";
import { LocalEmbeddingProvider } from "./local.js";
import { type EmbeddingProvider } from "./provider.js";
import { OpenAICompatibleEmbeddingProvider } from "./remote.js";

export { type EmbeddingProvider, l2normalize } from "./provider.js";
export { LocalEmbeddingProvider } from "./local.js";
export { OpenAICompatibleEmbeddingProvider } from "./remote.js";
export { setEmbeddingUsageSink, type EmbeddingUsage } from "./usage-sink.js";

let cached: EmbeddingProvider | undefined;

/**
 * Devuelve el proveedor de embeddings configurado vía EMBEDDINGS_PROVIDER
 * (local | openai | nan | voyage). Por defecto "local" para arrancar sin claves.
 * Singleton perezoso.
 */
export function getEmbeddingProvider(): EmbeddingProvider {
  if (cached) return cached;
  const provider = getEnv("EMBEDDINGS_PROVIDER", "local").toLowerCase();
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
    case "nan":
      // Servidor nan.builders (OpenAI-compatible), modelo qwen3-embedding (4096-dim).
      cached = new OpenAICompatibleEmbeddingProvider({
        apiKey: requireEnv("NAN_API_KEY"),
        baseURL: getEnv("NAN_BASE_URL", "https://api.nan.builders/v1"),
        model: getEnv("NAN_EMBEDDING_MODEL", "qwen3-embedding"),
        dim: Number(getEnv("NAN_EMBEDDING_DIM", "4096")),
      });
      break;
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
        `EMBEDDINGS_PROVIDER desconocido: "${provider}". Usa local | openai | nan | voyage.`,
      );
  }
  return cached;
}

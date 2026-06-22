import { getEnv, requireEnv } from "@cortex/shared";
import { LocalEmbeddingProvider } from "./local.js";
import { type EmbeddingProvider } from "./provider.js";
import { OpenAICompatibleEmbeddingProvider, VoyageEmbeddingProvider } from "./remote.js";

export { type EmbeddingProvider, l2normalize } from "./provider.js";
export { LocalEmbeddingProvider } from "./local.js";
export { OpenAICompatibleEmbeddingProvider, VoyageEmbeddingProvider } from "./remote.js";
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
      cached = new OpenAICompatibleEmbeddingProvider({
        apiKey: requireEnv("OPENAI_API_KEY"),
        baseURL: "https://api.openai.com/v1",
        model: "text-embedding-3-small",
        dim: 1536,
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
      cached = new VoyageEmbeddingProvider(requireEnv("VOYAGE_API_KEY"));
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

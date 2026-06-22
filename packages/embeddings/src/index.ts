import { getEnv, requireEnv } from "@cortex/shared";
import { LocalEmbeddingProvider } from "./local.js";
import { type EmbeddingProvider } from "./provider.js";
import { OpenAIEmbeddingProvider, VoyageEmbeddingProvider } from "./remote.js";

export { type EmbeddingProvider, l2normalize } from "./provider.js";
export { LocalEmbeddingProvider } from "./local.js";
export { OpenAIEmbeddingProvider, VoyageEmbeddingProvider } from "./remote.js";

let cached: EmbeddingProvider | undefined;

/**
 * Devuelve el proveedor de embeddings configurado vía EMBEDDINGS_PROVIDER
 * (local | openai | voyage). Por defecto "local" para arrancar sin claves.
 * Singleton perezoso.
 */
export function getEmbeddingProvider(): EmbeddingProvider {
  if (cached) return cached;
  const provider = getEnv("EMBEDDINGS_PROVIDER", "local").toLowerCase();
  switch (provider) {
    case "openai":
      cached = new OpenAIEmbeddingProvider(requireEnv("OPENAI_API_KEY"));
      break;
    case "voyage":
      cached = new VoyageEmbeddingProvider(requireEnv("VOYAGE_API_KEY"));
      break;
    case "local":
      cached = new LocalEmbeddingProvider();
      break;
    default:
      throw new Error(
        `EMBEDDINGS_PROVIDER desconocido: "${provider}". Usa local | openai | voyage.`,
      );
  }
  return cached;
}

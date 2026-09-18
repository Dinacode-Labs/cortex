import { getEnv, requireEnv } from "@cortex/shared";
import { LocalEmbeddingProvider } from "./local.js";
import { type EmbeddingProvider } from "./provider.js";
import { OpenAICompatibleEmbeddingProvider } from "./remote.js";

export { type EmbeddingProvider, l2normalize } from "./provider.js";
export { LocalEmbeddingProvider } from "./local.js";
export { OpenAICompatibleEmbeddingProvider } from "./remote.js";
export { setEmbeddingUsageSink, type EmbeddingUsage } from "./usage-sink.js";

let cached: EmbeddingProvider | undefined;

/** Drops the singleton. Tests only: in production the config does not change at runtime,
 *  and recreating the provider mid-ingest would mix dimensions. */
export function resetEmbeddingProvider(): void {
  cached = undefined;
}

let warnedNanAlias = false;

/** Reads the declared dimension and fails early when it is unusable: the dimension defines
 *  the vector schema, and an invalid value would go unnoticed until the first INSERT. */
function requireDim(raw: string): number {
  const dim = Number(raw);
  if (!Number.isInteger(dim) || dim <= 0) {
    throw new Error(`EMBEDDINGS_DIM must be a positive integer (got: "${raw}").`);
  }
  return dim;
}

/**
 * Returns the embedding provider configured through EMBEDDINGS_PROVIDER
 * (local | openai-compatible | openai | voyage). Defaults to "local" so it starts with no
 * keys. Lazy singleton.
 */
export function getEmbeddingProvider(): EmbeddingProvider {
  if (cached) return cached;
  // `|| "local"`: a variable that is declared but empty counts as "unset" and must fall
  // back to the default, not blow up startup with "unknown provider: ''".
  const provider = (getEnv("EMBEDDINGS_PROVIDER", "local").trim() || "local").toLowerCase();
  switch (provider) {
    case "openai":
      // Model/dim are configurable (ADR-0023). Default text-embedding-3-large (3072-dim,
      // good multilingual); drop to text-embedding-3-small (1536) for cost with
      // OPENAI_EMBEDDING_MODEL/OPENAI_EMBEDDING_DIM.
      cached = new OpenAICompatibleEmbeddingProvider({
        apiKey: requireEnv("OPENAI_API_KEY"),
        baseURL: "https://api.openai.com/v1",
        model: getEnv("OPENAI_EMBEDDING_MODEL", "text-embedding-3-large"),
        dim: Number(getEnv("OPENAI_EMBEDDING_DIM", "3072")),
      });
      break;
    case "nan": {
      // DEPRECATED ALIAS of openai-compatible with NaN's defaults. Removed in v0.2.0.
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
      // Any endpoint serving /v1/embeddings: NaN, Ollama, vLLM, TEI, LM Studio.
      // The dimension is MANDATORY: it cannot be guessed and it defines the vector schema.
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
      // Voyage is OpenAI-compatible for embeddings: the same client is reused (with retries
      // and unified usage reporting). Same env var, and the same failure when it is missing.
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
        `Unknown EMBEDDINGS_PROVIDER: "${provider}". Use local | openai-compatible | openai | voyage.`,
      );
  }
  return cached;
}

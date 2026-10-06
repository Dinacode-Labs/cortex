import { setEmbeddingUsageSink } from "@cortex/embeddings";
import { getEnv } from "@cortex/shared";
import { recordUsage } from "../application/usage.js";

// Registering the sink is EXPLICIT: the entrypoints call it (directly or through
// @cortex/agents' wireLlm()). It used to run as a side effect of importing a module, which made
// the accounting depend on import order.
let sinkRegistered = false;

export function registerUsageSink(): void {
  if (sinkRegistered) return;
  sinkRegistered = true;
  setEmbeddingUsageSink((u) => {
    void recordUsage({
      kind: "embedding",
      provider: getEnv("EMBEDDINGS_PROVIDER", "local").toLowerCase(),
      model: u.model,
      operation: "embedding",
      inputTokens: u.totalTokens,
      totalTokens: u.totalTokens,
    });
  });
}

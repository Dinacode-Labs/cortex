import { registerUsageSink, setClassifier, setMediaExtractor, setReranker } from "@cortex/core";
import { isLlmEnabled } from "@cortex/shared";
import { classifyEntry } from "./classify.js";
import { rerankLLM } from "./rerank.js";
import { createMediaExtractor } from "./media.js";
import { wireReconciler } from "./reconcile.js";

/**
 * ÚNICO punto de cableado de la capa LLM en core. Lo llama cada entrypoint tras
 * loadEnv() (antes este ritual estaba copiado con variaciones en mcp-server, web y
 * server, y parte se ejecutaba como side effect de import). Sin LLM configurado solo
 * registra el sink de uso de embeddings; core sigue funcionando con heurísticas.
 */
let wired = false;
export function wireLlm(): void {
  if (wired) return;
  wired = true;
  registerUsageSink();
  if (!isLlmEnabled()) return;
  setClassifier(classifyEntry);
  if (process.env.CORTEX_RERANK !== "off") setReranker(rerankLLM);
  const media = createMediaExtractor();
  if (media) setMediaExtractor(media);
  wireReconciler();
}

import { registerUsageSink, setClassifier, setMediaExtractor, setReranker } from "@cortex/core";
import { isLlmEnabled } from "@cortex/shared";
import { classifyEntry } from "./classify.js";
import { rerankLLM } from "./rerank.js";
import { createMediaExtractor } from "./media.js";
import { wireReconciler } from "./reconcile.js";

/**
 * The ONE place where the LLM layer is wired into core. Every entrypoint calls it after
 * loadEnv() (this ritual used to be copied, with variations, across mcp-server, web and
 * server, and part of it ran as an import side effect). With no LLM configured it only
 * registers the embedding usage sink; core keeps working on heuristics.
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

import { registerUsageSink, setClassifier, setGroupJudge, setMediaExtractor, setMergeDrafter, setReranker, setReconciler } from "@cortex/core";
import { classifyEntry } from "./agents/classifier/classify.js";
import { rerankLLM } from "./agents/reranker/rerank.js";
import { createMediaExtractor } from "./media/extractor.js";
import { draftMerge } from "./agents/merger/draft.js";
import { judgeGroups } from "./agents/judge/judge.js";
import { mergeKnowledge } from "./agents/merger/merge.js";
import { reconcile } from "./agents/reconciler/reconcile.js";
import { isLlmEnabled } from "./runtime/llm-config.js";

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
  setMergeDrafter(draftMerge);
  setGroupJudge(judgeGroups);
  wireReconciler();
}

let reconcilerWired = false;
export function wireReconciler(): void {
  if (reconcilerWired) return;
  reconcilerWired = true;
  setReconciler({ decide: reconcile, merge: mergeKnowledge });
}

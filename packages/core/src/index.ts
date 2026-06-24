export * from "./operations.js";
export * from "./queries.js";
export * from "./render.js";
export { lintProject, renderLintReport, type LintReport } from "./lint.js";
export { searchProjectCode, indexRepo, renderCodeHits, type CodeHit } from "./code.js";
export { applyTemporalInvalidation } from "./temporal.js";
export { storeEmbeddingsBatch } from "./vectors.js";
export { recordUsage, getUsageSummary, getRecentTraces, type UsageRecord, type UsageSummary, type TraceTree, type TraceSpan } from "./usage.js";
export { resolveEntity, relate, linkEntryToEntity } from "./entities.js";
export { resolveEntities, type ResolveResult } from "./resolve-entities.js";
export { resolveProjectFromCwd } from "./project-config.js";
export { isNearDuplicate, findNearest, updateEntryContent, invalidateEntry, UPDATE_THRESHOLD, NOOP_THRESHOLD, type NearestEntry } from "./dedup.js";
export { autoCurate, type CurationResult } from "./curate.js";
export {
  classifyType,
  extractEntities,
  canonicalize,
  deriveTitle,
  summarize,
} from "./text.js";

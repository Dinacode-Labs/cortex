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
export { resolveProjectFromCwd, readCortexLink, slugify, type CortexLink } from "./project-config.js";
export { findProjectBySlug, findProjectByName, createProject, resolveLinkedProject, canAccessProject, listAccessibleProjects, addProjectMember, isProjectMember, type ProjectRef } from "./projects.js";
export {
  isNearDuplicate,
  findNearest,
  updateEntryContent,
  invalidateEntry,
  setReconciler,
  saveWithReconciliation,
  reconcileProject,
  UPDATE_THRESHOLD,
  NOOP_THRESHOLD,
  type NearestEntry,
  type ReconcilerHooks,
  type ReconcileAction,
  type ReconcileResult,
} from "./dedup.js";
export { autoCurate, type CurationResult } from "./curate.js";
export { requestOtp, verifyOtp, validateToken, revokeToken, createUiTicket, redeemUiTicket, isAdmin, isAllowedEmail, type AuthUser } from "./auth.js";
export { sendOtpEmail } from "./email.js";
export { apiGet, apiPost, apiBase, isAuthenticated, type ApiResult } from "./api-client.js";
export { captureBatch, relateEntries, type BatchItem, type BatchItemResult } from "./capture.js";
export {
  classifyType,
  extractEntities,
  canonicalize,
  deriveTitle,
  summarize,
} from "./text.js";

export * from "./operations.js";
export * from "./queries.js";
export * from "./render.js";
export { lintProject, renderLintReport, type LintReport } from "./lint.js";
export { searchProjectCode, indexRepo, renderCodeHits, type CodeHit } from "./code.js";
export { applyTemporalInvalidation } from "./temporal.js";
export { storeEmbeddingsBatch } from "./vectors.js";
export { recordUsage, registerUsageSink, getUsageSummary, getRecentTraces, type UsageRecord, type UsageSummary, type TraceTree, type TraceSpan } from "./usage.js";
export { resolveEntity, relate, linkEntryToEntity } from "./entities.js";
export { resolveEntities, type ResolveResult } from "./resolve-entities.js";
export { resolveProjectFromCwd, readCortexLink, slugify, type CortexLink } from "./project-config.js";
export { findProjectBySlug, findProjectByName, getEntryProject, createProject, resolveLinkedProject, canAccessProject, listAccessibleProjects, addProjectMember, removeProjectMember, listProjectMembers, isProjectMember, type ProjectRef } from "./projects.js";
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
export { requestOtp, verifyOtp, validateToken, revokeToken, createUiTicket, redeemUiTicket, isAdmin, isAllowedEmail, listAdmins, type AuthUser } from "./auth.js";
export { sendOtpEmail } from "./email.js";
export { captureBatch, relateEntries, type BatchItem, type BatchItemResult } from "./capture.js";
export { extractFileText, SUPPORTED_EXTS, type ExtractedFile } from "./extract.js";
export {
  classifyType,
  extractEntities,
  canonicalize,
  deriveTitle,
  summarize,
} from "./text.js";

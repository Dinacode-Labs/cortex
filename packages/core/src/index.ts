export * from "./save.js";
export * from "./search.js";
export * from "./context-pack.js";
export * from "./queries.js";
export * from "./render.js";
export { lintProject, renderLintReport, type LintReport } from "./lint.js";
export { planLintActions, type LintAction } from "./lint-act.js";
export { searchProjectCode, indexRepo, renderCodeHits, IGNORE_DIRS, type CodeHit } from "./code.js";
export { applyTemporalInvalidation } from "./temporal.js";
export { storeEmbeddingsBatch } from "./vectors.js";
export { recordUsage, registerUsageSink, getUsageSummary, getRecentTraces, estimateCostUsd, resetPricingCache, type UsageRecord, type UsageSummary, type TraceTree, type TraceSpan } from "./usage.js";
export { resolveEntity, relate, linkEntryToEntity } from "./entities.js";
export { resolveEntities, type ResolveResult } from "./resolve-entities.js";
// `readCortexLink` vive en @cortex/client (es código de lado cliente, sin SQL); se
// re-exporta aquí porque core lo usa para resolver el proyecto de un repo.
export { readCortexLink, type CortexLink } from "@cortex/client";
export { slugify } from "./project-config.js";
export { findProjectBySlug, findProjectByName, getEntryProject, createProject, resolveLinkedProject, canAccessProject, checkProjectAccess, checkEntryAccess, listAccessibleProjects, addProjectMember, removeProjectMember, listProjectMembers, isProjectMember, canManageProject, updateProject, NotAManagerError, type ProjectRef, type AccessibleProject, type AccessCheck } from "./projects.js";
export {
  isNearDuplicate,
  findNearest,
  updateEntryContent,
  updateEntryFields,
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
export {
  sendOtpEmail,
  getEmailSender,
  setEmailSender,
  validateEmailConfig,
  type EmailSender,
  type EmailMessage,
} from "./email.js";
export { captureBatch, relateEntries, type BatchItem, type BatchItemResult } from "./capture.js";
export { chunkDocument, type DocChunk, type ChunkOptions } from "./chunk.js";
export { extractFileText, setMediaExtractor, SUPPORTED_EXTS, type ExtractedFile, type MediaExtractorHooks } from "./extract.js";
export {
  classifyType,
  extractEntities,
  canonicalize,
  deriveTitle,
  summarize,
} from "./text.js";
export {
  findSessionCapture,
  getSessionCaptureById,
  hashCondensed,
  markSessionCapture,
  reapStuckSessionCaptures,
  upsertSessionCapture,
  type SessionCapture,
  type SessionCaptureStatus,
} from "./session-captures.js";

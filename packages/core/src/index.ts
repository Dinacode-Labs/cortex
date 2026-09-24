export * from "./knowledge/save.js";
export * from "./knowledge/search.js";
export * from "./knowledge/context-pack.js";
export * from "./knowledge/queries.js";
export * from "./knowledge/render.js";
export { lintProject, renderLintReport, type LintReport } from "./knowledge/lint.js";
export { planLintActions, type LintAction } from "./knowledge/lint-act.js";
export { searchProjectCode, indexRepo, renderCodeHits, type CodeHit } from "./capture/code.js";
// Chunking, extension lists and directories to ignore live in `shared` now that the
// lightweight CLI needs them too (ADR-0058). They are re-exported so callers do not break.
export { chunkDocument, IGNORE_DIRS, SUPPORTED_EXTS, type ChunkOptions, type DocChunk } from "@cortex/shared";
export { applyTemporalInvalidation } from "./knowledge/temporal.js";
export { storeEmbeddingsBatch } from "./storage/vectors.js";
export { recordUsage, registerUsageSink, getUsageSummary, getRecentTraces, estimateCostUsd, resetPricingCache, type UsageRecord, type UsageSummary, type TraceTree, type TraceSpan } from "./observability/usage.js";
export { resolveEntity, relate, linkEntryToEntity } from "./graph/entities.js";
export {
  getAcrossClient,
  type AcrossClient,
  type SharedEntity,
  type CrossProjectContradiction,
} from "./graph/across.js";
export { resolveEntities, type ResolveResult } from "./graph/resolve-entities.js";
// `readCortexLink` lives in @cortex/client (it is client-side code, with no SQL); it is
// re-exported here because core uses it to resolve a repo's project.
export { readCortexLink, type CortexLink } from "@cortex/client";
export { slugify } from "./projects/project-config.js";
export { findProjectBySlug, findProjectByName, getEntryProject, createProject, resolveLinkedProject, canAccessProject, checkProjectAccess, checkEntryAccess, listAccessibleProjects, listChildProjects, listProjectAncestors, addProjectMember, removeProjectMember, listProjectMembers, isProjectMember, canManageProject, updateProject, deleteProject, NotAManagerError, ProjectNotEmptyError, type ProjectRef, type AccessibleProject, type AccessCheck } from "./projects/projects.js";
export { purgeEntries, canManageEntryProject, type PurgeResult } from "./projects/purge.js";
export {
  isNearDuplicate,
  findNearest,
  updateEntryContent,
  updateEntryFields,
  recordCorroboration,
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
} from "./knowledge/dedup.js";
export { autoCurate, type CurationResult } from "./knowledge/curate.js";
export { requestOtp, verifyOtp, validateToken, revokeToken, createUiTicket, redeemUiTicket, isAdmin, isAllowedEmail, listAdmins, type AuthUser } from "./identity/auth.js";
export {
  sendOtpEmail,
  getEmailSender,
  setEmailSender,
  validateEmailConfig,
  type EmailSender,
  type EmailMessage,
} from "./identity/email.js";
export { captureBatch, relateEntries, type BatchItem, type BatchItemResult } from "./capture/capture.js";
export { extractFileText, setMediaExtractor, type ExtractedFile, type MediaExtractorHooks } from "./capture/extract.js";
export {
  classifyType,
  extractEntities,
  canonicalize,
  deriveTitle,
  isDerivedSummary,
  stripMarkdown,
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
} from "./capture/session-captures.js";
